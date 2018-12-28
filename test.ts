import { CronJob } from "cron";
import Nano, {
	DocumentInsertResponse,
	DocumentListParams,
	DocumentListResponse,
	DocumentResponseRow,
	DocumentScope,
	ServerScope
} from "nano"


interface IDeleteDocument {
	_id: string
	_rev: string
	_deleted: boolean
}

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
const params: DocumentListParams = {
	include_docs: true
};

const responseVals: string[] = [];
const MIN_SIZE: number = 2000;


const ageTest = () => {
	const twoDaysSeconds: number = 60 * 60 * 24 * 2;
	const twoWeeksAgoTS: number = (+new Date()) - twoDaysSeconds;

	return (ts: number) => ts < twoWeeksAgoTS;
};

const chunk = (arr: any[], chunkSize: number, cache: any[] = []): any[][] => {
	const tmp = [...arr];
	while (tmp.length) {
		cache.push(tmp.splice(0, chunkSize));
	}
	return cache;
};

/**
 * Core function to iterate dbs and resolve conflicts for each.
 * @param {nano.DocumentScope<any>} db
 * @returns {Promise<void>}
 */
const iterateDocs = (db: DocumentScope<any>): Promise<any> => {
	return db.list(params).then((body: DocumentListResponse<any>) => {
		const { rows } = body;
		// Cache age test outside of main loop
		const isOlderThanTwoDays = ageTest();
		const isMinSize: boolean = rows.length > MIN_SIZE;

		// Sort before iterating if meets min size so we can start removing right away.
		const rowsSorted: DocumentResponseRow<any>[] = isMinSize
			? rows.concat().sort((a, b) => {
				return a.doc.updated_at - b.doc.updated_at;
			})
			: rows;

		// Get all documents matching deletion/pruning criteria.
		const deleteStack: IDeleteDocument[] = rowsSorted.reduce((base: IDeleteDocument[], row: DocumentResponseRow<any>) => {
			const { doc } = row;
			const { responses } = doc;
			if (!responses) {
				return [...base, { _id: row.key, _rev: row.value.rev, _deleted: true }]
			}

			const { updated } = doc;
			const responseKeys: string[] = Object.keys(responses);
			const responseHasGold: boolean = !!responses.gold ||
				responseKeys.some(k => k.toLowerCase() === "gold");
			const revisionNumber: number = +row.value.rev[0];
			const isNotMultiRevision: boolean = revisionNumber < 5;
			const deleteStackHasRoom = (rows.length - base.length) > MIN_SIZE;
			if (!responseHasGold && isMinSize && isNotMultiRevision && deleteStackHasRoom && isOlderThanTwoDays(updated)) {
				return [...base, { _id: row.key, _rev: row.value.rev, _deleted: true }]
			}

			return base;
		}, []);

		// return Object.keys(responses).map((key: string) => {
		// 	const currVal: string = responses[key].value;
		// 	if (currVal === "") {
		// 		return;
		// 		// return console.log("Empty val");
		// 	}
		// 	if (!responseVals.includes(currVal)) {
		// 		responseVals.push(currVal);
		// 	}
		// 	return currVal;
		// });

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
					}).then(() => {
						console.log("COMPACTING::", dbName);
						return remoteCouch.db.compact(dbName)
					});
				}
				return console.log(`Skipping db ${dbName}`);
			});
		}, Promise.resolve());
	}).catch(console.error);
};

iterateDatabases()
// .then(() => {
// 	const vals: string = JSON.stringify(responseVals, null, 2);
// 	console.log(vals);
// })
	.catch(console.error);
