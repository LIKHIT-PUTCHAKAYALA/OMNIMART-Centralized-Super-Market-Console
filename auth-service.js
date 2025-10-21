import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const log = (message) => {
    const logData = { service: 'Auth Service', message: message };
    process.stdout.write(`LOG::${JSON.stringify(logData)}\n`);
};

const startServer = async () => {
    try {
        const adapter = new JSONFile('db.json');
        const defaultData = { 
            users: {
                "O1001": { "username": "owner", "password": "123", "name": "Store Owner", "role": "owner", "maxDiscount": 100, "allowedPages": ["dashboard", "pos", "inventory", "orders", "users", "suppliers", "settings"] },
                "A1001": { "username": "admin", "password": "123", "name": "Admin User", "role": "admin", "maxDiscount": 100, "allowedPages": ["dashboard", "pos", "inventory", "orders", "users", "suppliers", "settings"] },
                "S1001": { "username": "staff", "password": "123", "name": "Jane Smith", "role": "staff", "maxDiscount": 10, "allowedPages": ["pos", "inventory", "orders"], "address": "", "education": "", "mobile": "", "emergencyMobile": "", "salary": "", "experience": "" },
                "M1001": { "username": "seller1", "password": "123", "name": "Local Farms", "role": "seller", "maxDiscount": 0, "allowedPages": ["inventory", "suppliers"], "address": "", "merchantName": "Local Farms Inc.", "supplyItems": "Vegetables", "mobile": ""},
                "C1001": { "username": "customer", "password": "123", "name": "Valued Customer", "role": "customer", "maxDiscount": 0, "allowedPages": ["pos"], "loyaltyPoints": 150, "phone": "555-555-5555" }
            },
            lastIdCounters: { owner: 1001, admin: 1001, staff: 1001, seller: 1001, customer: 1001 }
        };
        const db = new Low(adapter, defaultData);
        await db.read();
        
        if (!db.data || !db.data.lastIdCounters) {
             log('Database is missing or outdated. Seeding with new default data.');
             db.data = defaultData;
             await db.write();
        }

        const app = express();
        app.use(cors({ origin: '*' }));
        app.use(express.json());
        
        app.post('/login', (req, res) => {
            const { username, password } = req.body;
            const userEntry = Object.entries(db.data.users).find(([id, u]) => u.username === username);
            if (userEntry && userEntry[1].password === password) {
                const [userId, user] = userEntry;
                log(`User '${username}' (ID: ${userId}) logged in successfully.`);
                res.json({ message: 'Login successful', user: { id: userId, ...user } });
            } else {
                log(`Failed login attempt for user '${username}'.`);
                res.status(401).json({ message: 'Invalid credentials' });
            }
        });

        app.get('/users', (req, res) => {
            res.json(db.data.users);
        });

        app.post('/users/:userId/points', async (req, res) => {
            const { userId } = req.params;
            const { points } = req.body;
            if (db.data.users[userId]) {
                db.data.users[userId].loyaltyPoints = (db.data.users[userId].loyaltyPoints || 0) + points;
                await db.write();
                log(`Awarded ${points} points to user ${userId}. New total: ${db.data.users[userId].loyaltyPoints}`);
                res.status(200).json({ message: "Points updated." });
            } else {
                res.status(404).json({ message: "User not found." });
            }
        });

        app.post('/users', async (req, res) => {
            const userData = req.body;
            const existingUser = Object.values(db.data.users).find(u => u.username === userData.username);
            if (existingUser) {
                log(`Attempted to create user with existing username '${userData.username}'.`);
                return res.status(400).json({ message: 'Username already exists.' });
            }
            
            const rolePrefixMap = { owner: 'O', admin: 'A', staff: 'S', seller: 'M', customer: 'C' };
            const prefix = rolePrefixMap[userData.role] || 'U';
            const newIdCounter = ++db.data.lastIdCounters[userData.role];
            const newUserId = `${prefix}${newIdCounter}`;

            db.data.users[newUserId] = userData;
            await db.write();
            log(`User '${userData.username}' created with ID ${newUserId}.`);
            res.status(201).json({ message: 'User created.' });
        });

        app.put('/users/:userId', async (req, res) => {
            const { userId } = req.params;
            const userData = req.body;
            if (!db.data.users[userId]) { return res.status(404).json({ message: 'User not found.' }); }
            
            const existingUserWithNewUsername = Object.entries(db.data.users).find(([id, u]) => u.username === userData.username && id !== userId);
            if (existingUserWithNewUsername) {
                return res.status(400).json({ message: 'This username is already taken by another user.' });
            }

            if (!userData.password) { userData.password = db.data.users[userId].password; }
            db.data.users[userId] = { ...db.data.users[userId], ...userData };
            await db.write();
            log(`User ID '${userId}' updated.`);
            res.json({ message: 'User updated.' });
        });

        app.delete('/users/:userId', async (req, res) => {
            const { userId } = req.params;
            if (!db.data.users[userId]) { return res.status(404).json({ message: 'User not found.' }); }
            if (db.data.users[userId].role === 'owner') {
                log(`Attempted to delete protected user ID '${userId}'.`);
                return res.status(403).json({ message: 'Cannot delete the primary owner.' });
            }
            delete db.data.users[userId];
            await db.write();
            log(`User ID '${userId}' deleted.`);
            res.json({ message: 'User deleted.' });
        });

        app.post('/shutdown', (req, res) => {
            log('Shutdown signal received. Exiting.');
            res.status(200).send({ message: 'Shutting down.' });
            process.exit(0);
        });

        const PORT = 3001;
        app.listen(PORT, () => {
            log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        log(`FATAL: Failed to start server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

