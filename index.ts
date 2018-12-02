import Nano, {
	DocumentGetResponse,
	DocumentListParams,
	DocumentListResponse,
	DocumentResponseRow,
	DocumentScope,
	ServerScope
} from "nano"
import { latestWins } from "./deconflict";

const AUTH: string = Buffer.from("admin:hkHM0Hut78HEe9TyLg6e").toString("base64");
const DB_URLS = {
	local: "http://couch_acdb:5984",
	remote: "https://acdbapi.com/"
};


/*               DB Refs
 ========================================= */

const localCouch: ServerScope = Nano(DB_URLS.local);
const remoteCouch: ServerScope = Nano({
	url: DB_URLS.remote,
	requestDefaults: {
		headers: {
			"Authorization": `Basic ${AUTH}`
		}
	}
});
const testDB: DocumentScope<any> = remoteCouch.db.use("determineifapinisaclosematchtothehighlightedregion");


// const testing = setInterval(() => {
// 	console.log("ts::", +(new Date()));
// }, 10000);

remoteCouch.db.list().then((body) => {
	return body.forEach((db) => {
		console.log(db);
	});
}).then(() => {
	const params: DocumentListParams = {
		conflicts: true,
		include_docs: true
	};
	testDB.list(params).then((body: DocumentListResponse<any>) => {
		body.rows.forEach((doc: DocumentResponseRow<any>) => {
			// output each document's body
			if (doc.doc._conflicts && doc.doc._conflicts.length) {
				return latestWins(testDB, doc.doc._id, "updated")
					.then((res: DocumentGetResponse) => {
						console.log("latestWins::res::", res, "\n");
					});
			}
			return {};
		});
	});
}).catch(console.error);
