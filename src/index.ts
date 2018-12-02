import { CronJob } from "cron";
import Nano, {
	DocumentGetResponse,
	DocumentListParams,
	DocumentListResponse,
	DocumentResponseRow,
	DocumentScope,
	ServerScope
} from "nano"
import { pickLatestRevs } from "./deconflict";


// const AUTH: string = Buffer.from("admin:hkHM0Hut78HEe9TyLg6e").toString("base64");
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

const localCouch: ServerScope = Nano(DB_URLS.local);
// const localCouch: ServerScope = Nano({
// 	url: DB_URLS.remote,
// 	requestDefaults: {
// 		headers: { "Authorization": `Basic ${AUTH}` }
// 	}
// });
const params: DocumentListParams = {
	conflicts: true,
	include_docs: true
};

/**
 * Core function to iterate dbs and resolve conflicts for each.
 * @param {nano.DocumentScope<any>} db
 * @returns {Promise<void>}
 */
const resolveConflicts = (db: DocumentScope<any>): Promise<any> => {
	return db.list(params).then((body: DocumentListResponse<any>) => {
		return body.rows.forEach((doc: DocumentResponseRow<any>) => {
			if (doc.doc._conflicts && doc.doc._conflicts.length) {
				return pickLatestRevs(db, doc.doc._id, "updated")
					.then((res: DocumentGetResponse) => {
						return console.log("pickLatestRevs::res::", res, "\n");
					});
			}
			return {};
		});
	});
};

/**
 * Conflict resolution wrapper.
 * @returns {Promise<void>}
 */
const cronPurgeDB = (): Promise<any> => {
	return localCouch.db.list().then((body: string[]) => {
		return body.reduce((p: Promise<any>, dbName: string, i: number) => {
			return p.then((): any => {
				if (!DB_BLACKLIST.includes(dbName)) {
					console.log("RESOLVE_CONFLICT::DB_NAME::", dbName);
					return resolveConflicts(localCouch.db.use(dbName)).then(() => {
						return localCouch.db.compact(dbName);
					});
				}
				return console.log("SKIPPING::DB_NAME::", dbName);
			});
		}, Promise.resolve());
	}).catch(console.error);
};


// Every day at 10:30am
const testCron: CronJob = new CronJob("0 16 10 * * *", () => {
	console.log(`cron::ts::${new Date()}`);
	cronPurgeDB().then(() => {
		console.log("FINISHED");
	}).catch(console.error);
}, null, true, "America/New_York");

testCron.start();

