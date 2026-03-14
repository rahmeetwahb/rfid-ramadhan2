import express from "express"
import bodyParser from "body-parser"
import dotenv from "dotenv"
import { 
    saveAttendance,
    getSessions,
    getParticipantList,
    getAttendanceList
} from "./sheets.js"

import dayjs from "dayjs"
import utc from "dayjs/plugin/utc.js"
import timezone from "dayjs/plugin/timezone.js"
import { getDashboardData } from "./sheets.js"

dayjs.extend(utc)
dayjs.extend(timezone)

dayjs.tz.setDefault("Asia/Jakarta")

dotenv.config()
const app = express()
app.use(bodyParser.json())
app.use(express.static("public"))

// ==============================
// RAM CACHE (SUPER CEPAT)
// ==============================

let participantCache = []
let attendanceCache = []
let sessionCache = []

// ==============================
// LOAD DATA KE RAM
// ==============================

async function loadCache(){

    participantCache = await getParticipantList()
    attendanceCache = await getAttendanceList()
    sessionCache = await getSessions()

    console.log("CACHE LOADED")
}

loadCache()

// reload cache tiap 5 menit
setInterval(loadCache,300000)

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

        const row = participantCache.find(r => r[0] === uid)

        if (!row) {
            lastScanResult = {
                status: "DENIED",
                name: "",
                session: "",
                message: "UID tidak terdaftar",
                time: Date.now()
            }
            return res.json(lastScanResult)
        }

        const participant = {
            name: row[1],
            type: row[2],
            dates: row[3]
        }

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
        const sessions = sessionCache

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

        // CEK SUDAH ABSEN ATAU BELUM
        // ==============================

        const today = dayjs().tz().format("YYYY-MM-DD")

        const already = attendanceCache.some(row =>
            row[0] === uid &&
            row[2].startsWith(today) &&
            row[3] === activeSession
        )

        if (already) {

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
        attendanceCache.push([
            uid,
            participant.name,
            dayjs().tz().format("YYYY-MM-DD HH:mm:ss"),
            activeSession
        ])

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
        📡 Sistem Presensi I'tikaf Masjid MABA
        </div>

        <div class="main">

        <audio id="successSound" src="/success.mp3" preload="auto"></audio>
        <audio id="deniedSound" src="/denied.mp3" preload="auto"></audio>

        <div class="name" id="name">Menunggu Scan...</div>
        <div class="session" id="session"></div>
        <div class="time" id="time"></div>

        </div>

        <div class="footer">
        Scan kartu untuk melakukan presensi I'tikaf
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

app.get("/api/dashboard",(req,res)=>{

    const today = dayjs().tz().format("YYYY-MM-DD")

    const todayAttendance = attendanceCache.filter(r =>
        r[2].startsWith(today)
    )

    const sessionStats = {}

    todayAttendance.forEach(r => {

        const session = r[3]

        if(!sessionStats[session]){
            sessionStats[session] = 0
        }

        sessionStats[session]++

    })

    res.json({

        totalPeserta: participantCache.length,
        totalHariIni: todayAttendance.length,
        sessions: sessionStats,
        last10: attendanceCache.slice(-10).reverse()

    })

})

app.get("/dashboard",(req,res)=>{

res.send(`

<html>

<head>

<title>Dashboard Presensi</title>

<style>

body{
background:#0f172a;
color:white;
font-family:Segoe UI;
margin:0;
}

.header{
background:#020617;
padding:20px;
font-size:28px;
font-weight:bold;
}

.container{
padding:30px;
}

.cards{
display:flex;
gap:20px;
margin-bottom:30px;
}

.card{
flex:1;
background:#1e293b;
padding:25px;
border-radius:10px;
font-size:22px;
text-align:center;
}

.sessionGrid{
display:grid;
grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
gap:20px;
margin-bottom:40px;
}

.sessionCard{
background:#1e293b;
padding:20px;
border-radius:10px;
text-align:center;
font-size:20px;
}

.table{
width:100%;
border-collapse:collapse;
}

.table th,.table td{
padding:12px;
border-bottom:1px solid #334155;
}

.table th{
background:#020617;
}

</style>

</head>

<body>

<div class="header">
📊 Dashboard Presensi I'tikaf
</div>

<div class="container">

<div class="cards">

<div class="card">
Total Peserta
<br>
<span id="totalPeserta">0</span>
</div>

<div class="card">
Hadir Hari Ini
<br>
<span id="today">0</span>
</div>

</div>

<h2>Presensi Per Session</h2>

<div class="sessionGrid" id="sessionStats"></div>

<h2>Presensi Terakhir</h2>

<table class="table">

<thead>

<tr>
<th>UID</th>
<th>Nama</th>
<th>Waktu</th>
<th>Session</th>
</tr>

</thead>

<tbody id="tableData"></tbody>

</table>

</div>

<script>

async function loadDashboard(){

const res = await fetch("/api/dashboard")
const data = await res.json()

document.getElementById("totalPeserta").innerText = data.totalPeserta
document.getElementById("today").innerText = data.totalHariIni

// =========================
// SESSION STATS
// =========================

let sessionHTML = ""

for(const s in data.sessions){

sessionHTML += \`

<div class="sessionCard">

\${s}
<br><br>
<b>\${data.sessions[s]}</b>

</div>

\`

}

document.getElementById("sessionStats").innerHTML = sessionHTML

// =========================
// TABLE
// =========================

let table=""

data.last10.forEach(row=>{

table += \`

<tr>
<td>\${row[0]}</td>
<td>\${row[1]}</td>
<td>\${row[2]}</td>
<td>\${row[3]}</td>
</tr>

\`

})

document.getElementById("tableData").innerHTML = table

}

// refresh tiap 2 detik
setInterval(loadDashboard,2000)

loadDashboard()

</script>

</body>

</html>

`)
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log("Server jalan di port", PORT)
})
