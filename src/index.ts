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
const resolveConflicts = (db: DocumentScope<any>) => {
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
const cronPurgeDB = () => {
	return localCouch.db.list().then((body: string[]) => {
		return body.reduce((p, dbName) => {
			return p.then(() => {
				return resolveConflicts(localCouch.db.use(dbName))
			});
		}, Promise.resolve());
	}).catch(console.error);
};

const testCron: CronJob = new CronJob("15 * * * * *", () => {
	console.log(`ts::${+new Date()}`);
}, null, true, "America/New_York");

testCron.start();

