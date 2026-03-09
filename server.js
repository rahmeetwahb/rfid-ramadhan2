import express from "express"
import bodyParser from "body-parser"
import dotenv from "dotenv"
import { 
    saveAttendance, 
    getParticipant, 
    alreadyScannedSession,
    getSessions
} from "./sheets.js"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc.js"
import timezone from "dayjs/plugin/timezone.js"
import { getLatestAttendance } from "./sheets.js"

dayjs.extend(utc)
dayjs.extend(timezone)

dayjs.tz.setDefault("Asia/Jakarta")

dotenv.config()
const app = express()
app.use(bodyParser.json())
app.use(express.static("public"))

// ==============================
// CEK TANGGAL
// ==============================
function isAllowed(participant) {
    const today = dayjs().tz().date()

    if (participant.type === "FULL") {
        return today >= 1 && today <= 20
    }

    if (participant.type === "CUSTOM") {
        if (!participant.dates) return false
        const allowedDates = participant.dates.split(",").map(Number)
        return allowedDates.includes(today)
    }

    return false
}

// ==============================
// CEK JAM
// ==============================
function isWithinTime(start, end) {

    start = String(start).replace(".", ":")
    end = String(end).replace(".", ":")

    const now = dayjs().tz()
    const nowMinutes = now.hour() * 60 + now.minute()

    const [startHour, startMinute] = start.split(":").map(Number)
    const [endHour, endMinute] = end.split(":").map(Number)

    const startMinutes = startHour * 60 + startMinute
    const endMinutes = endHour * 60 + endMinute

    return nowMinutes >= startMinutes && nowMinutes <= endMinutes
}

let lastScanResult = {
    status: "IDLE",
    name: "",
    session: "",
    message: "Menunggu Scan...",
    time: 0
}

// ==============================
// ENDPOINT SCAN
// ==============================
app.post("/scan", async (req, res) => {
    try {
        const { uid } = req.body

        if (!uid) {
            lastScanResult = { status: "DENIED",name: "", session: "", message: "UID kosong", time: Date.now() }
            return res.json(lastScanResult)
        }

        const participant = await getParticipant(uid)

        if (!participant) {
            lastScanResult = { status: "DENIED",name: "", session: "", message: "UID tidak terdaftar", time: Date.now() }
            return res.json(lastScanResult)
        }

        if (!isAllowed(participant)) {
            lastScanResult = { status: "DENIED",name: "", session: "", message: "Hari ini tidak termasuk pilihan", time: Date.now() }
            return res.json(lastScanResult)
        }

        // ==============================
        // CEK JAM DARI SHEET
        // ==============================
        const sessions = await getSessions()

        let allowedTime = false
        let activeSession = ""

        for (let session of sessions) {
            const start = session[1]
            const end = session[2]

            if (isWithinTime(start, end)) {
                allowedTime = true
                activeSession = session[0]
                break
            }
        }

        if (!allowedTime) {
            lastScanResult = { status: "DENIED",name: "", session: "", message: "Di luar jam absensi", time: Date.now() }
            return res.json(lastScanResult)
        }

        // 🔥 DOUBLE CHECK DI SINI SAJA
        if (await alreadyScannedSession(uid, activeSession)) {
            lastScanResult = {
                status: "DENIED",
                name: "", 
                session: "",
                message: "Sudah absen di session ini",
                time: Date.now()
            }
            return res.json(lastScanResult)
        }

        await saveAttendance(uid, participant.name, activeSession)

        lastScanResult = {
            status: "SUCCESS",
            name: participant.name,
            session: activeSession,
            message: "Absensi diterima",
            time: Date.now()
        }
        return res.json(lastScanResult)

    } catch (error) {
        console.error(error)
        return res.status(500).json({ status: "ERROR", message: "Server error" })
    }
})

app.get("/latest", (req, res) => {
    res.json(lastScanResult)
})

app.get("/tv", (req, res) => {
    res.send(`
    <html>
        <head>
        <title>Attendance TV</title>

        <style>

        body{
        background:black;
        color:white;
        text-align:center;
        font-family:Arial;
        margin-top:10%;
        transition:0.5s;
        }

        .name{
        font-size:70px;
        font-weight:bold;
        }

        .session{
        font-size:40px;
        margin-top:20px;
        }

        .time{
        font-size:30px;
        margin-top:20px;
        }

        </style>

        </head>

        <body>
        <audio id="successSound" src="/success.mp3"></audio>
        <audio id="deniedSound" src="/denied.mp3"></audio>

        <div class="name" id="name">Menunggu Scan...</div>
        <div class="session" id="session"></div>
        <div class="time" id="time"></div>

        <script>

            let lastEventTime = 0

            async function fetchLatest(){

            const res = await fetch("/latest")
            const data = await res.json()

            const nameEl = document.getElementById("name")
            const sessionEl = document.getElementById("session")
            const successSound = document.getElementById("successSound")
            const deniedSound = document.getElementById("deniedSound")

            // hanya update jika scan baru
            if(data.time !== lastEventTime){

            lastEventTime = data.time

            if(data.status === "SUCCESS"){

            document.body.style.background="green"

            successSound.currentTime = 0
            successSound.play()

            nameEl.innerText = data.name
            sessionEl.innerText = "Session : " + data.session

            }

            else if(data.status === "DENIED"){

            document.body.style.background="red"

            successSound.currentTime = 0
            successSound.play()

            nameEl.innerText = data.message
            sessionEl.innerText = ""

            }

            // reset setelah 3 detik
            setTimeout(()=>{

            document.body.style.background="black"
            nameEl.innerText="Menunggu Scan..."
            sessionEl.innerText=""

            },3000)

            }

            }

            setInterval(fetchLatest,1000)

            fetchLatest()

        </script>

        </body>
    </html>
`)
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log("Server jalan di port", PORT)
})
