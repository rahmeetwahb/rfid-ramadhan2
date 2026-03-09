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
        background:#0f172a;
        color:white;
        text-align:center;
        font-family:Segoe UI,Arial;
        margin:0;
        display:flex;
        flex-direction:column;
        height:100vh;
        transition:0.4s;
        }

        /* HEADER */

        .header{
        background:#020617;
        padding:20px;
        font-size:35px;
        font-weight:bold;
        letter-spacing:2px;
        box-shadow:0 3px 10px rgba(0,0,0,0.5);
        }

        /* MAIN */

        .main{
        flex:1;
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        }

        .name{
        font-size:80px;
        font-weight:bold;
        margin-top:20px;
        }

        .session{
        font-size:40px;
        margin-top:10px;
        opacity:0.9;
        }

        .time{
        font-size:35px;
        margin-top:30px;
        opacity:0.8;
        }

        /* FOOTER */

        .footer{
        background:#020617;
        padding:15px;
        font-size:20px;
        opacity:0.8;
        }

        /* STATUS COLORS */

        .success{
        background:#14532d;
        }

        .denied{
        background:#7f1d1d;
        }

        #fullscreenBtn{
        position:fixed;
        top:10px;
        right:10px;
        padding:10px 20px;
        font-size:16px;
        background:#2563eb;
        color:white;
        border:none;
        border-radius:6px;
        cursor:pointer;
        z-index:999;
        }

    </style>

    </head>

    <body>
        <button id="fullscreenBtn" onclick="goFullscreen()">
            Klik untuk Fullscreen
        </button>
        <div class="header">
        📡 Sistem Absensi RFID
        </div>

        <div class="main">

        <audio id="successSound" src="/success.mp3" preload="auto"></audio>
        <audio id="deniedSound" src="/denied.mp3" preload="auto"></audio>

        <div class="name" id="name">Menunggu Scan...</div>
        <div class="session" id="session"></div>
        <div class="time" id="time"></div>

        </div>

        <div class="footer">
        Scan kartu RFID untuk melakukan absensi
        </div>

        <script>

        let lastEventTime = 0

        function updateClock(){

        const now = new Date()

        const time =
        now.getHours().toString().padStart(2,"0") + ":" +
        now.getMinutes().toString().padStart(2,"0") + ":" +
        now.getSeconds().toString().padStart(2,"0")

        document.getElementById("time").innerText = time

        }

        setInterval(updateClock,1000)

        async function fetchLatest(){

        const res = await fetch("/latest")
        const data = await res.json()

        const nameEl = document.getElementById("name")
        const sessionEl = document.getElementById("session")

        const successSound = document.getElementById("successSound")
        const deniedSound = document.getElementById("deniedSound")

        if(data.time !== lastEventTime){

        lastEventTime = data.time

        if(data.status === "SUCCESS"){

        document.body.classList.remove("denied")
        document.body.classList.add("success")

        successSound.currentTime = 0
        successSound.play()

        nameEl.innerText = data.name
        sessionEl.innerText = "Session : " + data.session

        }

        else if(data.status === "DENIED"){

        document.body.classList.remove("success")
        document.body.classList.add("denied")

        deniedSound.currentTime = 0
        deniedSound.play()

        nameEl.innerText = data.message
        sessionEl.innerText = ""

        }

        setTimeout(()=>{

        document.body.classList.remove("success")
        document.body.classList.remove("denied")

        nameEl.innerText="Menunggu Scan..."
        sessionEl.innerText=""

        },3000)

        }

        }

        setInterval(fetchLatest,1000)

        fetchLatest()
        updateClock()

        function goFullscreen(){

        const el = document.documentElement

        if(el.requestFullscreen){
        el.requestFullscreen()
        }
        else if(el.webkitRequestFullscreen){
        el.webkitRequestFullscreen()
        }
        else if(el.msRequestFullscreen){
        el.msRequestFullscreen()
        }

        document.getElementById("fullscreenBtn").style.display="none"

        }
        window.onload = () => {

        setTimeout(()=>{
        goFullscreen()
        },1000)

        }
        </script>

    </body>
</html>
`)
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log("Server jalan di port", PORT)
})
