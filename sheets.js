import { google } from "googleapis"
import dayjs from "dayjs"

let raw = process.env.GOOGLE_CREDENTIALS

// hilangkan escape tambahan dari railway
raw = raw.replace(/^"|"$/g, '')
raw = raw.replace(/\\"/g, '"')

const credentials = JSON.parse(raw)

credentials.private_key = credentials.private_key.replace(/\\n/g, "\n")

const auth = new google.auth.GoogleAuth({
  credentials: credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
})

const sheets = google.sheets({ version: "v4", auth })
const SPREADSHEET_ID = process.env.SPREADSHEET_ID

export async function getParticipant(uid) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "peserta-akhwat!A2:D100"
    })

    const rows = res.data.values

    for (let row of rows) {
        if (row[0] === uid) {
            return {
                name: row[1],
                type: row[2],       // FULL atau CUSTOM
                dates: row[3]       // contoh: 21,23,25
            }
        }
    }

    return null
}

export async function saveAttendance(uid, name, session) {
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "presensi-akhwat!A2",
        valueInputOption: "RAW",
        requestBody: {
            values: [
                [
                    uid,
                    name,
                    dayjs().tz().format("YYYY-MM-DD HH:mm:ss"),
                    session
                ]
            ]
        }
    })
}

export async function alreadyScannedSession(uid, session) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "presensi-akhwat!A2:D1000"
    })

    const rows = res.data.values || []
    const today = dayjs().tz().format("YYYY-MM-DD")

    for (let row of rows) {
        const rowUid = row[0]
        const rowTime = row[2]
        const rowSession = row[3]

        if (
            rowUid === uid &&
            rowTime.startsWith(today) &&
            rowSession === session
        ) {
            return true
        }
    }

    return false
}

export async function getSessions() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Settings!A2:C10",
        valueRenderOption: "FORMATTED_VALUE"
    })

    return res.data.values || []
}

export async function getLatestAttendance() {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "presensi-akhwat!A2:D1000"
    })

    const rows = res.data.values || []

    if (rows.length === 0) return null

    const last = rows[rows.length - 1]

    return {
        uid: last[0],
        name: last[1],
        time: last[2],
        session: last[3]
    }
}

export async function getParticipantList(){

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "peserta-akhwat!A2:D"
    })

    return res.data.values || []
}

export async function getAttendanceList(){

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "presensi-akhwat!A2:D"
    })

    return res.data.values || []
}

export async function getDashboardData() {

    const pesertaRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "peserta-akhwat!A2:D"
    })

    const presensiRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "presensi-akhwat!A2:D"
    })

    const peserta = pesertaRes.data.values || []
    const presensi = presensiRes.data.values || []

    const today = dayjs().tz().format("YYYY-MM-DD")

    const todayAttendance = presensi.filter(r => r[2]?.startsWith(today))

    // ==========================
    // HITUNG PER SESSION
    // ==========================

    const sessionStats = {}

    todayAttendance.forEach(row => {

        const session = row[3]

        if (!sessionStats[session]) {
            sessionStats[session] = 0
        }

        sessionStats[session]++

    })

    return {

        totalPeserta: peserta.length,
        totalHariIni: todayAttendance.length,
        sessions: sessionStats,
        last10: presensi.slice(-10).reverse()

    }

}