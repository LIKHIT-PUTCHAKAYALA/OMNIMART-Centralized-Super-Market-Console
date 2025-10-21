import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const log = (message) => {
    const logData = { service: 'Settings Service', message: message };
    process.stdout.write(`LOG::${JSON.stringify(logData)}\n`);
};

const startServer = async () => {
    try {
        const adapter = new JSONFile('settings_db.json');
        const defaultData = { 
            storeName: "OMNI-MART",
            ownerName: "Store Owner",
            storeAddress: "123 Market St, Anytown",
            footerMessage: "Thank you for choosing OMNI-MART!",
            logo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1zaG9wcGluZy1iYXNrZXQiPjxwYXRoIGQ9Im01IDE1IDEtMTAgaDEyTDE5IDE1WiIvPjxwYXRoIGQ9Ik0xIDE1aDIyIi8+PHBhdGggZD0iTTEyIDNhNS44IDUuOCAwIDAgMCAtNS44IDUuOEwwIDE1Ii8+PHBhdGggZD0iTTIyIDE1bC0yLjIgLTYuMkE1LjggNS44IDAgMCAwIDEyIDMiLz48L3N2Zz4=",
            backgroundOpacity: 0.05
        };
        const db = new Low(adapter, defaultData);
        await db.read();
        db.data = db.data || defaultData;
        await db.write();

        const app = express();
        app.use(cors({ origin: '*' }));
        app.use(express.json({ limit: '5mb' }));
        
        app.get('/settings', (req, res) => {
            res.json(db.data);
        });

        app.post('/settings', async (req, res) => {
            db.data = req.body;
            await db.write();
            log('Brand and bill settings have been updated.');
            res.status(200).json(db.data);
        });
        
        app.post('/shutdown', (req, res) => {
            log('Shutdown signal received. Exiting.');
            res.status(200).send({ message: 'Shutting down.' });
            process.exit(0);
        });

        const PORT = 3005;
        app.listen(PORT, () => {
            log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        log(`FATAL: Failed to start server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

