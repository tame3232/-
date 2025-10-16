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
const BOT_TOKEN = process.env.BOT_TOKEN || '967116528:AAEo5uRrgJZ4fZGtRwcWVPtOkKHG-0MTPpE'; // የእርስዎን ቶክን ለመጠቀም ቀይሬዋለሁ

// የውሂብ ማስቀመጫ ፋይል (Database Placeholder)
const DB_FILE = path.join('/tmp', 'user_data.json'); // Netlify /tmp directory
const DAILY_RESET_MS = 24 * 60 * 60 * 1000;
const SPIN_MAX_ATTEMPTS = 5;
const QUIZ_MAX_ATTEMPTS = 5;
const DAILY_BONUS_POINTS = 500;
// 💡 አዲስ የጌም ቋሚዎች
const SCRATCH_MAX_CLAIM = 1; // በቀን አንድ ጊዜ
const LUCKYBOX_MAX_ATTEMPTS = 2; // በቀን ሁለት ጊዜ

// =======================================================
// 2. የቴሌግራም ዳታ ማረጋገጫ (INIT DATA VERIFICATION)
// =======================================================

// verifyTelegramInitData ተግባር ሳይለወጥ ይቀራል

/**
 * የቴሌግራም Web App Init Dataን በትክክል መፈረሙን ያረጋግጣል።
 * @param {string} initData - የቴሌግራም initData string
 * @returns {object | false} የተተነተነ የዩዘር ዳታ ወይም false
 */
function verifyTelegramInitData(initData) {
    const parts = initData.split('&').filter(p => !p.startsWith('hash='));
    parts.sort();
    const dataCheckString = parts.join('\n');

    const hashMatch = initData.match(/hash=([a-fA-F0-9]+)/);
    if (!hashMatch) return false;
    const receivedHash = hashMatch[1];

    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    if (calculatedHash !== receivedHash) {
        console.log("❌ Hash Mismatch!");
        return false;
    }
    
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
// 3. የውሂብ ማስቀመጫ (DATABASE) ተግባራት
// =======================================================

function loadDatabase() {
    try {
        // የ Netlify Function ከበፊቱ ያደረጋቸውን ለውጦች ለመጠቀም
        const data = fs.readFileSync(DB_FILE, 'utf8'); 
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function saveDatabase(db) {
    try {
        // 💡 ዳታውን በ Netlify /tmp ውስጥ ማስቀመጥ
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving database file:", e);
    }
}

function getInitialUserData(userId) {
    const db = loadDatabase();
    if (!db[userId]) {
        // 💡 አዲስ ተጠቃሚ: አዲስ የጌም ዳታ ታክሏል!
        db[userId] = {
            points: 0,
            spin_data: { attempts: SPIN_MAX_ATTEMPTS, last_spin: 0 },
            quiz_data: { attempts: QUIZ_MAX_ATTEMPTS, last_quiz: 0 },
            daily_bonus: { last_claim: 0 },
            
            // 💡 አዲስ የጨዋታ ዳታ
            scratch_data: { last_claim: 0, claims_made: 0 },
            luckybox_data: { attempts: LUCKYBOX_MAX_ATTEMPTS, last_claim: 0 }
        };
        saveDatabase(db);
    }
    
    // 💡 የቆዩ ተጠቃሚዎች አዲሱን ዳታ እንዲያገኙ (Migration)
    if (!db[userId].scratch_data) {
        db[userId].scratch_data = { last_claim: 0, claims_made: 0 };
    }
    if (!db[userId].luckybox_data) {
        db[userId].luckybox_data = { attempts: LUCKYBOX_MAX_ATTEMPTS, last_claim: 0 };
    }
    
    return db[userId];
}

function updateUserData(userId, newData) {
    const db = loadDatabase();
    // 💡 ወሳኝ ማስተካከያ: ዳታውን አዘምኖ ወዲያውኑ ያስቀምጣል!
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
    const { action, init_data, task_id, prize_options, game_id, points_gained } = req.body;

    const user = verifyTelegramInitData(init_data);
    if (!user) {
        return res.status(401).json({ error: "❌ Unauthorized Access: Invalid init_data hash" });
    }

    const userId = user.id;
    let userData = getInitialUserData(userId);
    const now = Date.now();

    // ********** A. የመጀመሪያ ዳታ ጥያቄ **********
    if (action === "request_initial_data") {
        return res.json({
            action: "initial_data",
            points: userData.points,
            spin_data: userData.spin_data,
            quiz_data: userData.quiz_data,
            tasks_status: userData.tasks_status,
            daily_bonus: userData.daily_bonus,
            // 💡 አዲስ የጌም ዳታ ተልኳል
            scratch_data: userData.scratch_data,
            luckybox_data: userData.luckybox_data
        });
    }

    // ... B. የማህበራዊ Task ማረጋገጫ (ያለ ለውጥ) ...
    if (action === "verify_social_task") {
        // ... (ያለ ለውጥ)
    }
    
    // ********** C. ዕለታዊ ጉርሻ (Daily Bonus) **********
    if (action === "claim_daily_bonus") {
        const lastClaim = userData.daily_bonus.last_claim || 0;
        
        if (now - lastClaim < DAILY_RESET_MS) {
            return res.json({ action: "daily_bonus_claimed", success: false, reason: "Already claimed today" });
        }
        
        userData.points += DAILY_BONUS_POINTS;
        userData.daily_bonus.last_claim = now;
        
        const updatedData = updateUserData(userId, userData); // 💡 ነጥብ ተመዝግቧል
        
        return res.json({
            action: "daily_bonus_claimed",
            success: true,
            new_points: updatedData.points,
            last_claim: updatedData.daily_bonus.last_claim
        });
    }

    // ********** D. Spin Attempt **********
    if (action === "spin_attempt") {
       // ... (ያለ ለውጥ)
    }

    // ********** F. 💡 አዲስ: የጨዋታ ሽልማት መውሰድ (Game Prize Claim) **********
    if (action === "claim_game_prize") {
        
        if (!points_gained || points_gained < 0) {
            return res.status(400).json({ error: "Invalid points value" });
        }

        let gameData = {};
        let success = false;

        if (game_id === 'scratch_card') {
            gameData = userData.scratch_data;
            if (gameData.claims_made >= SCRATCH_MAX_CLAIM && (now - gameData.last_claim < DAILY_RESET_MS)) {
                return res.status(400).json({ error: "Scratch Card already claimed today." });
            }
            // 24 ሰዓት ካለፈ ወይም ለመጀመሪያ ጊዜ ከሆነ
            if (now - gameData.last_claim >= DAILY_RESET_MS) {
                gameData.claims_made = 0; // ዳግም አስጀምር
            }
            
            if (gameData.claims_made < SCRATCH_MAX_CLAIM) {
                gameData.claims_made += 1;
                gameData.last_claim = now;
                userData.points += points_gained;
                userData.scratch_data = gameData;
                success = true;
            }
            
        } else if (game_id === 'lucky_box') {
            gameData = userData.luckybox_data;

            if (gameData.attempts <= 0 && (now - gameData.last_claim < DAILY_RESET_MS)) {
                 return res.status(400).json({ error: "Lucky Box attempts exhausted for today." });
            }
            
            // 24 ሰዓት ካለፈ
            if (now - gameData.last_claim >= DAILY_RESET_MS) {
                gameData.attempts = LUCKYBOX_MAX_ATTEMPTS; // ዳግም አስጀምር
                gameData.last_claim = 0;
            }
            
            if (gameData.attempts > 0) {
                gameData.attempts -= 1;
                userData.points += points_gained;
                
                // የመጨረሻ ሙከራ ከሆነ የጊዜ መለኪያውን አድስ
                if (gameData.attempts === 0) {
                     gameData.last_claim = now;
                }
                
                userData.luckybox_data = gameData;
                success = true;
            }

        } else {
            return res.status(400).json({ error: "Unknown game ID" });
        }
        
        if (success) {
            const updatedData = updateUserData(userId, userData); // 💡 ነጥብ እና የጌም ሁኔታ ተመዝግቧል
            return res.json({
                action: "game_prize_claimed",
                game_id: game_id,
                points_gained: points_gained,
                new_points: updatedData.points,
                
                // ለ Frontend ዝማኔ
                scratch_data: updatedData.scratch_data, 
                luckybox_data: updatedData.luckybox_data 
            });
        }
    }


    // ********** E. Tasks ዳግም ማስጀመር **********
    if (action === "request_spin_reset" || action === "request_quiz_reset" || action === "request_full_reset") {
        let shouldReset = false;
        
        // ... (ነባር የ Spin እና Quiz ዳግም ማስጀመር) ...

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
        
        // 💡 አዲስ: የጌም ዳግም ማስጀመር
        if (action === "request_full_reset") {
             // Scratch Card
             if (now - userData.scratch_data.last_claim >= DAILY_RESET_MS) {
                 userData.scratch_data.claims_made = 0;
                 userData.scratch_data.last_claim = now;
                 shouldReset = true;
             }
             // Lucky Box
             if (now - userData.luckybox_data.last_claim >= DAILY_RESET_MS) {
                 userData.luckybox_data.attempts = LUCKYBOX_MAX_ATTEMPTS;
                 userData.luckybox_data.last_claim = now;
                 shouldReset = true;
             }
        }

        if (shouldReset) {
            const updatedData = updateUserData(userId, userData);
            return res.json({
                action: "attempts_refreshed",
                spin_data: updatedData.spin_data,
                quiz_data: updatedData.quiz_data,
                scratch_data: updatedData.scratch_data, // 💡 አዲስ ዳታ
                luckybox_data: updatedData.luckybox_data // 💡 አዲስ ዳታ
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
