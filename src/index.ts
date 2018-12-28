import { CronJob } from "cron";
import Nano, {
	DocumentGetResponse,
	DocumentInsertResponse,
	DocumentListParams,
	DocumentListResponse,
	DocumentResponseRow,
	DocumentScope,
	ServerScope
} from "nano"
import { pickLatestRevs } from "./deconflict";


export interface IDeleteDocument {
	_id: string
	_rev: string
	_deleted: boolean
}

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

const MIN_SIZE: number = 2000;

/**
 * Util function for checking record age.
 * @returns {(ts: number) => boolean}
 */
const ageTestDays = (days: number) => {
	const daysSeconds: number = 60 * 60 * 24 * days;
	const twoWeeksAgoTS: number = (+new Date()) - daysSeconds;

	return (ts: number) => ts < twoWeeksAgoTS;
};

/**
 * Util function to chunk an array of chunks (arrays).
 * @param {any[]} arr
 * @param {number} chunkSize
 * @param {any[]} cache
 * @returns {any[][]}
 */
const chunk = (arr: any[], chunkSize: number, cache: any[] = []): any[][] => {
	const tmp = [...arr];
	while (tmp.length) {
		cache.push(tmp.splice(0, chunkSize));
	}
	return cache;
};

/**
 * Prune documents older than 2 days if db exceeds minimum size.
 * @param {nano.DocumentScope<any>} db
 * @returns {Promise<any>}
 */
const pruneDocuments = (db: DocumentScope<any>) => {
	return db.list(params).then((body: DocumentListResponse<any>) => {
		const { rows } = body;

		// Cache age test functions outside of main loop
		const isOlderThanTwoDays = ageTestDays(2);
		const isOlderThanTwoMonths = ageTestDays(61);

		const isMinSize: boolean = rows.length > MIN_SIZE;
		if (!isMinSize) {
			return [];
		}

		// Sort before iterating if meets min size so we can start removing right away.
		const rowsSorted: DocumentResponseRow<any>[] = rows.concat().sort((a, b) => {
			return a.doc.updated_at - b.doc.updated_at;
		});

		// Get all documents matching deletion/pruning criteria.
		const deleteStack: IDeleteDocument[] = rowsSorted.reduce((base: IDeleteDocument[], row: DocumentResponseRow<any>) => {
			const { doc } = row;
			const { responses } = doc;
			if (!responses) {
				return [...base, { _id: row.key, _rev: row.value.rev, _deleted: true }]
			}

			const { updated } = doc;
			const responseKeys: string[] = Object.keys(responses);
			const responseHasGold: boolean = !!responses.gold || responseKeys.some(k => k.toLowerCase() === "gold");
			if (responseHasGold) {
				return base;
			}

			const revisionNumber: number = +row.value.rev[0];
			const deleteStackHasRoom = (rows.length - base.length) > MIN_SIZE;
			const isNotMultiRevision: boolean = revisionNumber < 5 && !isOlderThanTwoMonths(updated);
			if (isNotMultiRevision && deleteStackHasRoom && isOlderThanTwoDays(updated)) {
				return [...base, { _id: row.key, _rev: row.value.rev, _deleted: true }]
			}

			return base;
		}, []);

		if (deleteStack.length < 500) {
			return db.bulk({ docs: deleteStack }).then((body: DocumentInsertResponse[]) => {
				console.log("Finish prune.");
				return body;
			});
		}

		const chunks: IDeleteDocument[][] = chunk(deleteStack, 500);
		return chunks.reduce(async (base: Promise<any>, chunk: IDeleteDocument[], i: number) => {
			await base;
			return db.bulk({ docs: chunk }).then((body: DocumentInsertResponse[]) => {
				console.log("Finish pruning chunk:: ", i);
				return body;
			});
		}, Promise.resolve([]))
	});
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
		return body.reduce((p: Promise<any>, dbName: string) => {
			return p.then(async (): Promise<any> => {

				// Run optimizations on non-restricted db's
				if (!DB_BLACKLIST.includes(dbName)) {
					const targetDB = localCouch.db.use(dbName);

					// Prune before resolving conflicts
					console.log("DB_PRUNE::DB_NAME::", dbName);
					await pruneDocuments(targetDB);

					console.log("DE_CONFLICT::DB_NAME::", dbName);
					await resolveConflicts(targetDB);

					console.log("COMPACT::DB_NAME::", dbName);
					await localCouch.db.compact(dbName);

					return console.log("FINISHED::DB_NAME::", dbName);
				}

				return console.log("SKIPPING::DB_NAME::", dbName);
			});
		}, Promise.resolve());
	}).catch(console.error);
};


// Every day at 5:30am
const testCron: CronJob = new CronJob("0 30 5 * * *", () => {
	console.log(`cron::ts::${new Date()}`);
	cronPurgeDB().then(() => {
		console.log("FINISHED::ALL");
	}).catch(console.error);
}, null, true, "America/New_York");

testCron.start();

