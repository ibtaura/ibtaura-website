// ============================================================
// Google Apps Script — IBT Aura Team Onboarding Backend
// ============================================================
// 1. Open Google Sheets → create a new blank spreadsheet
// 2. Go to Extensions → Apps Script
// 3. Delete the default code and paste this entire file
// 4. Click Deploy → New deployment
// 5. Type = "Web app"
// 6. Execute as: "Me"
// 7. Who has access: "Anyone"
// 8. Click Deploy → copy the URL
// 9. Give the URL to update in onboarding.html and admin.html
// ============================================================

var ADMIN_PASSWORD = 'aura2026';
var SHEET_NAME = 'Submissions';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'Submitted At', 'Full Name', 'Email ID', 'Mobile Number',
        'Preferred Time to Work', 'On-site / Online', 'Technical Skills',
        'Passive Skills', 'Travel Availability', 'Additional Description'
      ]);
      sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    }

    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy, hh:mm a');

    sheet.appendRow([
      now,
      data.fullName || '',
      data.email || '',
      data.mobile || '',
      data.preferredTime || '',
      data.workMode || '',
      data.technicalSkills || '',
      data.passiveSkills || '',
      data.travel || '',
      data.additional || ''
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var password = e.parameter.password;

  if (password !== ADMIN_PASSWORD) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Wrong password' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet || sheet.getLastRow() < 2) {
    return ContentService.createTextOutput(JSON.stringify({ submissions: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
  var submissions = [];

  for (var i = 0; i < rows.length; i++) {
    submissions.push({
      submittedAt: rows[i][0],
      fullName: rows[i][1],
      email: rows[i][2],
      mobile: rows[i][3],
      preferredTime: rows[i][4],
      workMode: rows[i][5],
      technicalSkills: rows[i][6],
      passiveSkills: rows[i][7],
      travel: rows[i][8],
      additional: rows[i][9]
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ submissions: submissions }))
    .setMimeType(ContentService.MimeType.JSON);
}
