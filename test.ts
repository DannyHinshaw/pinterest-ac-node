import { CronJob } from "cron";
import Nano, { DocumentListParams, DocumentListResponse, DocumentResponseRow, DocumentScope, ServerScope } from "nano"


const AUTH: string = Buffer.from("admin:hkHM0Hut78HEe9TyLg6e").toString("base64");
const DB_URLS = {
	local: "http://couch_acdb:5984",
	remote: "https://acdbapi.com/"
};
const DB_BLACKLIST: string[] = [
	"_users",
	"_replicator"
];


/*               DB Refs
 ========================================= */

// const localCouch: ServerScope = Nano(DB_URLS.local);
const remoteCouch: ServerScope = Nano({
	url: DB_URLS.remote,
	requestDefaults: {
		headers: { "Authorization": `Basic ${AUTH}` }
	}
});
const params: DocumentListParams = { include_docs: true };
const responseVals: string[] = [];

/**
 * Core function to iterate dbs and resolve conflicts for each.
 * @param {nano.DocumentScope<any>} db
 * @returns {Promise<void>}
 */
const iterateDocs = (db: DocumentScope<any>): Promise<any> => {
	return db.list(params).then((body: DocumentListResponse<any>) => {
		return body.rows.forEach((doc: DocumentResponseRow<any>) => {
			const { responses } = doc.doc;
			if (!responses) {
				return;
			}
			return Object.keys(responses).forEach((key: string) => {
				const currVal: string = responses[key].value;
				if (currVal === "") {
					return console.log("Empty val");
				}
				if (!responseVals.includes(currVal)) {
					responseVals.push(currVal);
				}
				return currVal;
			});
		});
	});
};

/**
 * Conflict resolution wrapper.
 * @returns {Promise<void>}
 */
const iterateDatabases = (): Promise<any> => {
	return remoteCouch.db.list().then((body: string[]) => {
		return body.reduce((p: Promise<any>, dbName: string, i: number) => {
			return p.then((): any => {
				if (!DB_BLACKLIST.includes(dbName)) {
					return iterateDocs(remoteCouch.db.use(dbName)).then(() => {
						return console.log(`Finished db ${dbName}`);
					});
				}
				return console.log(`Skipping db ${dbName}`);
			});
		}, Promise.resolve());
	}).catch(console.error);
};

iterateDatabases()
	.then(() => {
		const vals: string = JSON.stringify(responseVals, null, 2);
		console.log(vals);
	}).catch(console.error);
