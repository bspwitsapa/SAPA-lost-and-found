// --- Sheet Names ---
const USER_SHEET_NAME = "Users";
const LOST_ITEMS_SHEET_NAME = "LostItems";
const FOUND_ITEMS_SHEET_NAME = "FoundItems";
const CLAIMED_ITEMS_LOG_SHEET_NAME = "ClaimedItemsLog";
const RESOLVED_LOST_ITEMS_LOG_SHEET_NAME = "ResolvedLostItemsLog"; // Optional: Create this sheet if you want to log resolved lost items

// --- Google Drive Folder ID for Image Uploads ---
const IMAGE_UPLOAD_FOLDER_ID = "1WX5s16NP0RwPwvPo1mf-DriF9ZopA_S5"; // User's Provided Folder ID

const ss = SpreadsheetApp.getActiveSpreadsheet();
const userSheet = ss.getSheetByName(USER_SHEET_NAME);
const lostItemSheet = ss.getSheetByName(LOST_ITEMS_SHEET_NAME);
const foundItemSheet = ss.getSheetByName(FOUND_ITEMS_SHEET_NAME);
const claimedItemLogSheet = ss.getSheetByName(CLAIMED_ITEMS_LOG_SHEET_NAME);
const resolvedLostItemLogSheet = ss.getSheetByName(RESOLVED_LOST_ITEMS_LOG_SHEET_NAME);

function doGet(e) {
  let action = e.parameter.action;
  let params = e.parameter;
  let responsePayload;

  try {
    if (!action) throw new Error("Action parameter is missing for GET request.");
    switch (action) {
      case "getItems":
        responsePayload = getItems(params.type);
        break;
      case "getItemDetails":
        if (!params.itemId || !params.itemType) throw new Error("itemId and itemType are required for getItemDetails.");
        responsePayload = getItemDetails(params.itemId, params.itemType);
        break;
      case "getUsers":
        responsePayload = getUsers();
        break;
      default:
        responsePayload = { status: "error", message: "Invalid GET action: " + action };
    }
  } catch (error) {
    Logger.log("doGet Error: " + error.toString() + "\nParams: " + JSON.stringify(params) + "\nStack: " + error.stack);
    responsePayload = { status: "error", message: "Server error (GET): " + error.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(responsePayload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let responsePayload;
  let requestData;
  try {
    if (!e.postData || !e.postData.contents) throw new Error("No post data received.");
    requestData = JSON.parse(e.postData.contents);
    let action = requestData.action;
    if (!action) throw new Error("Action parameter is missing for POST request.");

    switch (action) {
      case "loginUser":
        responsePayload = loginUser(requestData.payload);
        break;
      case "addLostItem":
        responsePayload = addLostItem(requestData.payload);
        break;
      case "addFoundItemWithImageUpload":
        responsePayload = addFoundItemWithImageUpload(requestData.payload);
        break;
      case "resolveLostItem":
        responsePayload = resolveLostItemWithLogAndImage(requestData.payload);
        break;
      case "claimFoundItem":
        responsePayload = recordClaimAndRemoveFoundItem(requestData.payload);
        break;
      case "addUser":
        responsePayload = addUser(requestData.payload);
        break;
      case "editUser":
        responsePayload = editUser(requestData.payload);
        break;
      case "deleteUser":
        responsePayload = deleteUser(requestData.payload.userId);
        break;
      default:
        responsePayload = { status: "error", message: "Invalid POST action: " + action };
    }
  } catch (error) {
    Logger.log("doPost Error: " + error.toString() + "\nPayload: " + JSON.stringify(requestData) + "\nStack: " + error.stack);
    responsePayload = { status: "error", message: "Server error (POST): " + error.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(responsePayload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getNextId(sheet, idColumnIndex = 0) {
  if (!sheet) {
    const errorMessage = "Error in getNextId: Sheet object is null. Check sheet name ('" + (sheet ? sheet.getName() : "UNKNOWN") + "') and ensure it exists.";
    Logger.log(errorMessage);
    throw new Error(errorMessage);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return 1;

  const headerRowValue = sheet.getRange(1, idColumnIndex + 1, 1, 1).getValue();
  const startRow = (typeof headerRowValue === 'string' && isNaN(parseInt(headerRowValue))) ? 2 : 1;

  if (lastRow < startRow) return 1;

  const idsRange = sheet.getRange(startRow, idColumnIndex + 1, lastRow - startRow + 1, 1);
  if (!idsRange) return 1;
  const ids = idsRange.getValues();

  const maxId = ids.reduce((max, row) => {
    const currentId = parseInt(row[0]);
    return (!isNaN(currentId) && currentId > max) ? currentId : max;
  }, 0);
  return maxId + 1;
}

function uploadBase64ImageToDrive(imageBase64, fileNamePrefix, itemId) {
    if (!imageBase64 || !imageBase64.startsWith("data:image")) {
        Logger.log("No valid Base64 image data provided for upload for " + fileNamePrefix + "/ID: " + itemId);
        return "";
    }
    if (!IMAGE_UPLOAD_FOLDER_ID || IMAGE_UPLOAD_FOLDER_ID === "YOUR_GOOGLE_DRIVE_FOLDER_ID" || IMAGE_UPLOAD_FOLDER_ID.trim() === "") {
        Logger.log("Error: IMAGE_UPLOAD_FOLDER_ID is not configured. Cannot upload image for " + fileNamePrefix + "/ID: " + itemId);
        return "";
    }
    try {
        const parts = imageBase64.split(',');
        if (parts.length < 2) throw new Error("Invalid Base64 image data format.");
        const imageBase64Data = parts[1];
        const MimeMatch = imageBase64.match(/:(.*?);/);
        if (!MimeMatch || MimeMatch.length < 2) throw new Error("Could not determine MIME type from Base64 string.");
        const imageMimeType = MimeMatch[1];
        const fileExtension = imageMimeType.split('/')[1] || 'jpg';
        const fileName = `${fileNamePrefix}_${itemId}_${new Date().getTime()}.${fileExtension}`;
        const decodedImage = Utilities.base64Decode(imageBase64Data);
        const imageBlob = Utilities.newBlob(decodedImage, imageMimeType, fileName);

        const folder = DriveApp.getFolderById(IMAGE_UPLOAD_FOLDER_ID);
        if (folder) {
            const file = folder.createFile(imageBlob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // Set sharing permission
            // Return the direct image link
            return "https://drive.google.com/uc?export=view&id=" + file.getId();
        } else {
            Logger.log("Error: Image upload folder not found with ID: " + IMAGE_UPLOAD_FOLDER_ID);
            return "";
        }
    } catch (e) {
        Logger.log(`Error uploading image to Drive for ${fileNamePrefix} ID ${itemId}: ` + e.toString() + "\nStack: " + e.stack);
        return "";
    }
}

function loginUser(payload) {
  if (!userSheet) return { status: "error", message: "User sheet ('" + USER_SHEET_NAME + "') not found." };
  const username = payload.username;
  const password = payload.password;
  const usersData = userSheet.getDataRange().getValues();
  for (let i = 1; i < usersData.length; i++) {
    if (usersData[i][1] === username && usersData[i][2] === password) {
      userSheet.getRange(i + 1, 7).setValue(new Date());
      return {
        status: "success",
        user: {
          userId: usersData[i][0],
          username: usersData[i][1],
          fullName: usersData[i][3],
          role: usersData[i][4]
        }
      };
    }
  }
  return { status: "error", message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
}

function addUser(payload) {
  if (!userSheet) return { status: "error", message: "User sheet ('" + USER_SHEET_NAME + "') not found." };
  const usersData = userSheet.getDataRange().getValues();
  const usernameExists = usersData.some((row, index) => index > 0 && row[1] === payload.username);
  if (usernameExists) {
    return { status: "error", message: "ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว" };
  }
  const userId = getNextId(userSheet, 0);
  const passwordToStore = payload.password;
  const dateCreated = new Date();
  userSheet.appendRow([userId, payload.username, passwordToStore, payload.fullName, payload.role, dateCreated, null]);
  return { status: "success", message: "เพิ่มผู้ใช้สำเร็จ", userId: userId };
}

function editUser(payload) {
  if (!userSheet) return { status: "error", message: "User sheet ('" + USER_SHEET_NAME + "') not found." };
  const usersData = userSheet.getDataRange().getValues();
  for (let i = 1; i < usersData.length; i++) {
    if (usersData[i][0] == payload.userId) {
      userSheet.getRange(i + 1, 2).setValue(payload.username);
      if (payload.password && payload.password.length > 0) {
        userSheet.getRange(i + 1, 3).setValue(payload.password);
      }
      userSheet.getRange(i + 1, 4).setValue(payload.fullName);
      userSheet.getRange(i + 1, 5).setValue(payload.role);
      return { status: "success", message: "แก้ไขข้อมูลผู้ใช้สำเร็จ" };
    }
  }
  return { status: "error", message: "ไม่พบผู้ใช้ที่ต้องการแก้ไข" };
}

function deleteUser(userId) {
  if (!userSheet) return { status: "error", message: "User sheet ('" + USER_SHEET_NAME + "') not found." };
  return deleteItemFromSheet(userSheet, userId, 0, "userId");
}

function getUsers() {
  if (!userSheet) return { status: "error", message: "User sheet ('" + USER_SHEET_NAME + "') not found." };
  const data = userSheet.getDataRange().getValues();
  if (data.length <= 1) return { status: "success", users: [] };
  const headers = data.shift();
  const users = data.map(row => ({
    userId: row[0],
    username: row[1],
    fullName: row[3],
    role: row[4],
    dateCreated: row[5] ? new Date(row[5]).toLocaleDateString('th-TH') : '',
    lastLogin: row[6] ? new Date(row[6]).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short'}) : '-'
  }));
  return { status: "success", users: users };
}

function addLostItem(payload) {
  if (!lostItemSheet) return { status: "error", message: "LostItems sheet ('" + LOST_ITEMS_SHEET_NAME + "') not found." };
  const lostItemId = getNextId(lostItemSheet, 0);
  const dateReported = new Date();
  lostItemSheet.appendRow([
    lostItemId,
    payload.reporterUserId,
    payload.reporterFullName,
    payload.reporterContactPhone,
    payload.reporterGrade || "",
    payload.itemType,
    payload.itemNameOrBrand || "",
    payload.itemColor || "",
    payload.itemDescription,
    payload.locationLost || "",
    payload.dateLost ? new Date(payload.dateLost).toISOString().split('T')[0] : "",
    dateReported,
    "actively_lost",
    payload.additionalNotes || ""
  ]);
  return { status: "success", message: "แจ้งของหายสำเร็จ", lostItemId: lostItemId };
}

function addFoundItemWithImageUpload(payload) {
  if (!foundItemSheet) return { status: "error", message: "FoundItems sheet ('" + FOUND_ITEMS_SHEET_NAME + "') not found." };

  const foundItemId = getNextId(foundItemSheet, 0);
  const dateReported = new Date();
  const uploadedFileUrl = uploadBase64ImageToDrive(payload.imageUrl, "SAPA_FoundItem", foundItemId);

  foundItemSheet.appendRow([
    foundItemId,
    payload.finderUserId,
    payload.finderFullName,
    payload.finderContactPhone || "",
    payload.itemType,
    payload.itemNameOrBrand || "",
    payload.itemColor || "",
    payload.itemDescription,
    payload.locationFound,
    payload.dateFound ? new Date(payload.dateFound).toISOString().split('T')[0] : "",
    dateReported,
    uploadedFileUrl, // Store the direct image URL
    payload.currentHoldingLocation || "ห้องสภานักเรียน",
    "awaiting_claim",
    payload.additionalNotes || ""
  ]);
  return { status: "success", message: "แจ้งเจอของสำเร็จ", foundItemId: foundItemId, imageUrl: uploadedFileUrl };
}

function getItems(type = 'all') {
  let items = [];
  const dateFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

  if (type === 'lost' || type === 'all') {
    if (!lostItemSheet) { Logger.log("LostItems sheet not found during getItems call."); }
    else {
      const lostData = lostItemSheet.getDataRange().getValues();
      if (lostData.length > 1) {
        const lostHeaders = lostData.shift();
        lostData.forEach(row => {
          items.push({
            itemId: row[0],
            reportType: 'lost',
            reporterUserId: row[1],
            itemType: row[5],
            description: row[8],
            location: row[9], // This is locationLost
            dateReportedSystem: row[11] ? new Date(row[11]).toLocaleDateString('th-TH', dateFormatOptions) : '-',
            dateReportedSystemRaw: row[11] ? new Date(row[11]) : null,
            status: row[12],
            reporterFullName: row[2],
            contactPhone: row[3],
            dateLostOrFound: row[10] ? new Date(row[10]).toLocaleDateString('th-TH', dateFormatOptions) : '-',
            // Lost items typically don't have an image URL from this sheet,
            // but if you add one, ensure the column index is correct here.
            // imageUrl: row[COLUMN_INDEX_FOR_LOST_ITEM_IMAGE_URL_IF_ANY]
          });
        });
      }
    }
  }

  if (type === 'found' || type === 'all') {
     if (!foundItemSheet) { Logger.log("FoundItems sheet not found during getItems call."); }
     else {
        const foundData = foundItemSheet.getDataRange().getValues();
        if (foundData.length > 1) {
            const foundHeaders = foundData.shift();
            foundData.forEach(row => {
            items.push({
                itemId: row[0], // Assuming column 0 is FoundItemID
                reportType: 'found',
                itemType: row[4],   // Assuming column 4 is itemType
                description: row[7], // Assuming column 7 is itemDescription
                location: row[8], // This is locationFound, assuming column 8
                dateReportedSystem: row[10] ? new Date(row[10]).toLocaleDateString('th-TH', dateFormatOptions) : '-', // Assuming column 10 is dateReported
                dateReportedSystemRaw: row[10] ? new Date(row[10]) : null,
                status: row[13], // Assuming column 13 is status
                reporterFullName: row[2], // Assuming column 2 is finderFullName
                contactPhone: row[3], // Assuming column 3 is finderContactPhone
                dateLostOrFound: row[9] ? new Date(row[9]).toLocaleDateString('th-TH', dateFormatOptions) : '-', // Assuming column 9 is dateFound
                imageUrl: row[11] // Assuming column 11 is imageUrl (already direct link from upload)
            });
            });
        }
     }
  }
  items.sort((a, b) => (b.dateReportedSystemRaw || 0) - (a.dateReportedSystemRaw || 0) );
  return { status: "success", items: items.map(({dateReportedSystemRaw, ...rest}) => rest) };
}

function getItemDetails(itemId, itemType) {
  let sheetToSearch;
  let headers;
  let itemDetails = {}; // Initialize itemDetails here

  if (itemType === 'lost') {
    sheetToSearch = lostItemSheet;
    if (!sheetToSearch) return { status: "error", message: "LostItems sheet ('" + LOST_ITEMS_SHEET_NAME + "') not found for details." };
  } else if (itemType === 'found') {
    sheetToSearch = foundItemSheet;
    if (!sheetToSearch) return { status: "error", message: "FoundItems sheet ('" + FOUND_ITEMS_SHEET_NAME + "') not found for details." };
  } else {
    return { status: "error", message: "Invalid item type for details: " + itemType };
  }

  const data = sheetToSearch.getDataRange().getValues();
  if (data.length <= 1) return { status: "error", message: "No data in sheet for " + itemType };
  headers = data.shift(); // Get headers
  const itemRow = data.find(row => row[0] == itemId); // Find item by ID (assuming ID is in column 0)

  if (itemRow) {
    // Map headers to itemRow values
    headers.forEach((header, i) => {
        if (itemRow[i] instanceof Date) {
            // Format dates as needed
            if (header === "dateReported" || header === "dateCreated" || header === "lastLogin" || header === "dateClaimed" || header === "dateResolved") { // Added dateResolved
                 itemDetails[header] = itemRow[i].toLocaleString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
            } else if (header === "dateLost" || header === "dateFound") {
                 itemDetails[header] = itemRow[i].toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
            } else {
                 itemDetails[header] = itemRow[i].toISOString(); // Default for other dates
            }
        } else {
            itemDetails[header] = itemRow[i];
        }
    });
    itemDetails.reportType = itemType; // Add reportType to the details

    // Specifically add user IDs if they exist based on headers (important for client-side logic)
    if (itemType === 'lost') {
        const reporterUserIdIndex = headers.indexOf('reporterUserId');
        if (reporterUserIdIndex > -1) itemDetails.reporterUserId = itemRow[reporterUserIdIndex];
    } else if (itemType === 'found') {
        const finderUserIdIndex = headers.indexOf('finderUserId');
        if (finderUserIdIndex > -1) itemDetails.finderUserId = itemRow[finderUserIdIndex];
        // Ensure imageUrl is included for found items
        const imageUrlIndex = headers.indexOf('imageUrl');
        if (imageUrlIndex > -1) itemDetails.imageUrl = itemRow[imageUrlIndex]; // This should be the direct link
    }
    return { status: "success", item: itemDetails };
  }
  return { status: "error", message: "ไม่พบข้อมูลของชิ้นนี้ (ID: " + itemId + ", Type: " + itemType + ")" };
}


function recordClaimAndRemoveFoundItem(payload) {
  if (!foundItemSheet) return { status: "error", message: "FoundItems sheet ('" + FOUND_ITEMS_SHEET_NAME + "') not found." };
  if (!claimedItemLogSheet) return { status: "error", message: "ClaimedItemsLog sheet ('" + CLAIMED_ITEMS_LOG_SHEET_NAME + "') not found." };

  const foundItemData = foundItemSheet.getDataRange().getValues();
  let itemToClaimDetails = {};
  let rowIndex = -1;

  // Column indices based on your addFoundItemWithImageUpload and getItems logic
  const foundItemIdCol = 0;
  const itemTypeCol = 4;
  const itemDescriptionCol = 7;

  for (let i = 1; i < foundItemData.length; i++) { // Start from 1 to skip header
    if (foundItemData[i][foundItemIdCol] == payload.foundItemId) {
      itemToClaimDetails = {
        foundItemId: foundItemData[i][foundItemIdCol],
        itemType: foundItemData[i][itemTypeCol],
        itemDescription: foundItemData[i][itemDescriptionCol]
      };
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) {
    return { status: "error", message: "ไม่พบของที่ต้องการบันทึกการรับคืนในระบบ (ID: " + payload.foundItemId + ")" };
  }

  const claimProofImageUrl = uploadBase64ImageToDrive(payload.claimProofImageBase64, "SAPA_ClaimProof", payload.foundItemId);

  const claimId = getNextId(claimedItemLogSheet, 0);
  const dateClaimed = new Date();
  claimedItemLogSheet.appendRow([
    claimId,
    itemToClaimDetails.foundItemId,
    itemToClaimDetails.itemType,
    itemToClaimDetails.itemDescription,
    payload.claimerFullName,
    dateClaimed,
    payload.actingUserId,
    payload.actingUserFullName,
    payload.returnNotes || "",
    claimProofImageUrl
  ]);

  foundItemSheet.deleteRow(rowIndex + 1); // rowIndex is 0-based for data array, but 1-based for sheet rows

  return { status: "success", message: "บันทึกการรับคืนของและลบรายการเจอของสำเร็จ", claimId: claimId, claimProofImageUrl: claimProofImageUrl };
}

function resolveLostItemWithLogAndImage(payload) {
  if (!lostItemSheet) return { status: "error", message: "LostItems sheet ('" + LOST_ITEMS_SHEET_NAME + "') not found." };

  let useResolvedLog = false;
  if (RESOLVED_LOST_ITEMS_LOG_SHEET_NAME && RESOLVED_LOST_ITEMS_LOG_SHEET_NAME.trim() !== "") {
      if (resolvedLostItemLogSheet) {
          useResolvedLog = true;
      } else {
          Logger.log("Warning: ResolvedLostItemsLog sheet ('" + RESOLVED_LOST_ITEMS_LOG_SHEET_NAME + "') defined but not found. Proceeding without logging resolved item details.");
      }
  } else {
      Logger.log("ResolvedLostItemsLog sheet name not configured. Proceeding without logging resolved item details.");
  }

  const resolveProofImageUrl = uploadBase64ImageToDrive(payload.resolveProofImageBase64, "SAPA_ResolvedLostProof", payload.lostItemId);

  if (useResolvedLog) {
    const logId = getNextId(resolvedLostItemLogSheet, 0);
    const dateResolved = new Date();
    resolvedLostItemLogSheet.appendRow([
      logId,
      payload.lostItemId,
      payload.resolvedByUserId,
      payload.resolvedByFullName,
      dateResolved,
      payload.resolveNotes || "",
      resolveProofImageUrl
    ]);
  }

  const deleteResult = deleteItemFromSheet(lostItemSheet, payload.lostItemId, 0, "lostItemId");
  if (deleteResult.status === "success") {
    return { status: "success", message: "ยืนยันการเจอของและลบรายการสำเร็จ", resolveProofImageUrl: resolveProofImageUrl };
  } else {
    // If deletion failed, but logging might have succeeded, this could be an issue.
    // However, the primary action is deletion.
    return deleteResult;
  }
}

function deleteItemFromSheet(sheet, itemId, idColumnIndex = 0, idName = "ID") {
  if (!sheet) {
      const sheetNameIfAvailable = idName ? idName.replace("Id", "") + "s" : "Unknown"; // e.g., userId -> Users
      const errorMessage = "Error in deleteItemFromSheet: Sheet object ('" + sheetNameIfAvailable + "') is null. Check sheet name and ensure it exists.";
      Logger.log(errorMessage);
      return { status: "error", message: errorMessage };
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { // Start from 1 to skip header row
    if (data[i][idColumnIndex] == itemId) { // Ensure type coercion if needed, but '==' is generally fine here.
      sheet.deleteRow(i + 1); // Sheet rows are 1-indexed, data array is 0-indexed after shift/header.
      return { status: "success", message: "ลบรายการ (" + idName + ": " + itemId + ") สำเร็จ" };
    }
  }
  return { status: "error", message: "ไม่พบรายการ (" + idName + ": " + itemId + ") ที่ต้องการลบ" };
}
