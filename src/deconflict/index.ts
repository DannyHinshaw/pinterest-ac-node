import { DocumentScope } from "nano";
import { IDeleteDocument } from "../index";


// This function takes the list of revisions and removes any deleted or not 'ok' ones.
// returns a flat array of document objects
const filterList = (list, excludeRev?) => {
	const retval = [];
	for (const i in list) {
		if (!list.hasOwnProperty(i)) {
			return retval;
		}
		if (list[i].ok && !list[i].ok._deleted) {
			if (!excludeRev || (excludeRev && list[i].ok._rev != excludeRev)) {
				// @ts-ignore
				retval.push(list[i].ok);
			}
		}
	}
	return retval;
};

// convert the incoming array of document to an array of deletions - {_id:"x",_rev:"y",_deleted:true}
const convertToDeletions = (list): IDeleteDocument[] => {
	const retval = [];
	for (const i in list) {
		if (!list.hasOwnProperty(i)) {
			return retval;
		}
		const obj = { _id: list[i]._id, _rev: list[i]._rev, _deleted: true };
		// @ts-ignore
		retval.push(obj);
	}
	return retval;
};

/**
 * Algorithm to determine winner by latest update.
 * @param {nano.DocumentScope<any>} db
 * @param {string} docId
 * @param {string} fieldName
 * @returns {Promise<any>}
 */
export const pickLatestRevs = (db: DocumentScope<any>, docId: string, fieldName: string): Promise<any> => {
	// fetch the document with open_revs=all
	// @ts-ignore
	return db.get(docId, { open_revs: "all" }).then((data) => {

		// remove 'deleted' leaf nodes from the list
		const docList = filterList(data);

		// if the there is only <=1 revision left, the document is either deleted
		// or not conflicted; either way, we're done
		if (docList.length <= 1) {
			return Promise.reject("Document is not conflicted.");
		}

		// sort the array of documents by the supplied fieldName
		// our winner will be the last object in the sorted array
		const docListSorted = [...docList].sort((a, b) => {
			return a[fieldName] - b[fieldName]
		});

		// turn the remaining leaf nodes into deletions
		const docListDeletes: IDeleteDocument[] = convertToDeletions(docListSorted.slice(0, -1));

		// return docListDeletes;
		// now we can delete the unwanted revisions
		return db.bulk({ docs: docListDeletes });

	});
};
