// tbot_handler.js
const express = require('express');
const serverless = require('serverless-http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// =======================================================
// 1. ውቅር (CONFIGURATION)
// =======================================================

// 💡 ወሳኝ: ይህንን በ Netlify Environment Variables ውስጥ ያስቀምጡ!
// ለሙከራ ከታች ያለውን የቦት ቶክን በመጠቀም የ SHA256 Hash Key ይስሩ!
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';

// የውሂብ ማስቀመጫ ፋይል (Database Placeholder)
const DB_FILE = path.join('/tmp', 'user_data.json'); // Netlify /tmp directory
const DAILY_RESET_MS = 24 * 60 * 60 * 1000;
const SPIN_MAX_ATTEMPTS = 5;
const QUIZ_MAX_ATTEMPTS = 5;
const DAILY_BONUS_POINTS = 500;

// =======================================================
// 2. የቴሌግራም ዳታ ማረጋገጫ (INIT DATA VERIFICATION)
// =======================================================

/**
 * የቴሌግራም Web App Init Dataን በትክክል መፈረሙን ያረጋግጣል።
 * @param {string} initData - የቴሌግራም initData string
 * @returns {object | false} የተተነተነ የዩዘር ዳታ ወይም false
 */
function verifyTelegramInitData(initData) {
    // 1. 'hash' የሚለውን መስክ ለይ
    const parts = initData.split('&').filter(p => !p.startsWith('hash='));
    parts.sort();
    const dataCheckString = parts.join('\n');

    const hashMatch = initData.match(/hash=([a-fA-F0-9]+)/);
    if (!hashMatch) return false;
    const receivedHash = hashMatch[1];

    // 2. የሲክሪት ቁልፍ (Secret Key) ስራ
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();

    // 3. ሃሽ (Hash) ስራ እና ማወዳደር
    const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    if (calculatedHash !== receivedHash) {
        console.log("❌ Hash Mismatch!");
        return false;
    }
    
    // 4. የተጠቃሚ መረጃ (User Data) ማውጣት
    const userDataMatch = initData.match(/user=({[^}]+})/);
    if (userDataMatch) {
        try {
            return JSON.parse(decodeURIComponent(userDataMatch[1]));
        } catch (e) {
            console.error("Error parsing user data:", e);
            return false;
        }
    }

    return false;
}

// =======================================================
// 3. የውሂብ ማስቀመጫ (DATABASE) ተግባራት (Placeholder)
// =======================================================

// 💡 ማስጠንቀቂያ: ይህ ለትምህርት እና ለሙከራ እንጂ ለትክክለኛ አገልግሎት አይደለም!
function loadDatabase() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        // ፋይሉ ከሌለ ወይም ባዶ ከሆነ ባዶ Database ይመልሳል
        return {};
    }
}

function saveDatabase(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving database file:", e);
    }
}

function getInitialUserData(userId) {
    const db = loadDatabase();
    if (!db[userId]) {
        // አዲስ ተጠቃሚ
        db[userId] = {
            points: 0,
            spin_data: { attempts: SPIN_MAX_ATTEMPTS, last_spin: 0 },
            quiz_data: { attempts: QUIZ_MAX_ATTEMPTS, last_quiz: 0 },
            tasks_status: {
                TG_CH: { completed: false, points: 150 },
                TG_GP: { completed: false, points: 100 },
                YT_SUB: { completed: false, points: 300 }
            },
            daily_bonus: { last_claim: 0 }
        };
        saveDatabase(db);
    }
    return db[userId];
}

function updateUserData(userId, newData) {
    const db = loadDatabase();
    db[userId] = { ...db[userId], ...newData };
    saveDatabase(db);
    return db[userId];
}

// =======================================================
// 4. Express App እና API Endpoints
// =======================================================

const app = express();
app.use(express.json());

app.post('/.netlify/functions/tbot_handler', async (req, res) => {
    const { action, init_data, task_id, prize_options } = req.body;

    // የInit Data ማረጋገጫ
    const user = verifyTelegramInitData(init_data);
    if (!user) {
        return res.status(401).json({ error: "❌ Unauthorized Access: Invalid init_data hash" });
    }

    const userId = user.id;
    let userData = getInitialUserData(userId);

    // ********** A. የመጀመሪያ ዳታ ጥያቄ **********
    if (action === "request_initial_data") {
        return res.json({
            action: "initial_data",
            points: userData.points,
            spin_data: userData.spin_data,
            quiz_data: userData.quiz_data,
            tasks_status: userData.tasks_status,
            daily_bonus: userData.daily_bonus
        });
    }

    // ********** B. የማህበራዊ Task ማረጋገጫ **********
    if (action === "verify_social_task") {
        const taskInfo = userData.tasks_status[task_id];

        // አስቀድሞ ከተጠናቀቀ
        if (taskInfo && taskInfo.completed) {
            return res.json({ action: "task_verified", task_id, success: true, new_points: userData.points, points_gained: 0 });
        }

        // 💡 ማሳሰቢያ: እዚህ ላይ የቴሌግራም ቦት APIን ተጠቅመው
        // ተጠቃሚው ቻናሉን/ግሩፑን እንደተቀላቀለ ማረጋገጥ አለብዎት።
        // ለምሳሌ: telegram.getChatMember(channel_id, user_id)
        
        // ለምሳሌ ያህል: ሁልጊዜ እንዲሳካ ያድርጉ (Placeholder)
        const isVerified = true; 

        if (isVerified) {
            const pointsToAdd = taskInfo ? taskInfo.points : 0;
            userData.points += pointsToAdd;
            userData.tasks_status[task_id] = { ...taskInfo, completed: true };

            const updatedData = updateUserData(userId, userData);

            return res.json({
                action: "task_verified",
                task_id,
                success: true,
                points_gained: pointsToAdd,
                new_points: updatedData.points
            });
        } else {
            return res.json({ action: "task_verified", task_id, success: false });
        }
    }
    
    // ********** C. ዕለታዊ ጉርሻ (Daily Bonus) **********
    if (action === "claim_daily_bonus") {
        const now = Date.now();
        const lastClaim = userData.daily_bonus.last_claim || 0;
        
        if (now - lastClaim < DAILY_RESET_MS) {
            return res.json({ action: "daily_bonus_claimed", success: false, reason: "Already claimed today" });
        }
        
        userData.points += DAILY_BONUS_POINTS;
        userData.daily_bonus.last_claim = now;
        
        const updatedData = updateUserData(userId, userData);
        
        return res.json({
            action: "daily_bonus_claimed",
            success: true,
            new_points: updatedData.points,
            last_claim: updatedData.daily_bonus.last_claim
        });
    }

    // ********** D. Spin Attempt **********
    if (action === "spin_attempt") {
        let spinData = userData.spin_data;
        const now = Date.now();

        // 1. የሙከራ ፍተሻ
        if (spinData.attempts <= 0) {
            return res.status(400).json({ error: "No attempts left." });
        }

        // 2. አሸናፊውን ምረጥ
        const prizeIndex = Math.floor(Math.random() * prize_options.length);
        const pointsWon = prize_options[prizeIndex];

        // 3. ዳታውን አዘምን
        spinData.attempts -= 1;
        spinData.last_spin = now; // የመጨረሻ ጊዜ አዘምን (ለሰዓት ቆጣሪ)
        userData.points += pointsWon;
        userData.spin_data = spinData;

        const updatedData = updateUserData(userId, userData);

        return res.json({
            action: "spin_result",
            points_won: pointsWon,
            new_points: updatedData.points,
            attempts_left: updatedData.spin_data.attempts,
            last_spin: updatedData.spin_data.last_spin
        });
    }

    // ********** E. Tasks ዳግም ማስጀመር **********
    if (action === "request_spin_reset" || action === "request_quiz_reset" || action === "request_full_reset") {
        const now = Date.now();
        let shouldReset = false;

        if (action === "request_spin_reset" || action === "request_full_reset") {
            if (now - userData.spin_data.last_spin >= DAILY_RESET_MS) {
                userData.spin_data.attempts = SPIN_MAX_ATTEMPTS;
                userData.spin_data.last_spin = now;
                shouldReset = true;
            }
        }
        
        if (action === "request_quiz_reset" || action === "request_full_reset") {
            if (now - userData.quiz_data.last_quiz >= DAILY_RESET_MS) {
                userData.quiz_data.attempts = QUIZ_MAX_ATTEMPTS;
                userData.quiz_data.last_quiz = now;
                shouldReset = true;
            }
        }
        
        if (action === "request_full_reset") {
             if (now - userData.daily_bonus.last_claim >= DAILY_RESET_MS) {
                 // የዕለታዊ ጉርሻ (Daily Bonus) ዳግም አይጀመርም፤ ይገኛል (Claimable) ብቻ ነው
                 // ዳግም ማስጀመር የሚያስፈልገው ነገር አለመኖሩን እናረጋግጣለን
                 shouldReset = true; 
             }
        }

        if (shouldReset || action === "request_initial_data") {
            const updatedData = updateUserData(userId, userData);
            return res.json({
                action: "attempts_refreshed",
                spin_data: updatedData.spin_data,
                quiz_data: updatedData.quiz_data
            });
        }
        
        return res.json({ action: "no_reset_needed" });
    }


    return res.status(400).json({ error: "Invalid action" });
});

// ለ Netlify Functions ተስማሚ ለማድረግ
module.exports.handler = serverless(app);

// የDB ፋይል መፈጠርን ያረጋግጡ (በ Netlify /tmp ውስጥ)
try {
    fs.statSync(DB_FILE);
} catch (e) {
    saveDatabase({}); // ፋይሉ ከሌለ ባዶ ይፍጠሩ
}
