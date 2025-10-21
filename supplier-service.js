import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const log = (message) => {
    const logData = { service: 'Supplier Service', message: message };
    process.stdout.write(`LOG::${JSON.stringify(logData)}\n`);
};

const startServer = async () => {
    try {
        const adapter = new JSONFile('suppliers_db.json');
        const defaultData = { 
            suppliers: {
                "SUP-0001": { "name": "Global Produce Co.", "contactPerson": "John Appleseed", "phone": "555-123-4567", "email": "john@globalproduce.com", "address": "123 Produce Lane", "supplies": "Fruits, Vegetables" },
                "SUP-0002": { "name": "Dairy Best Farms", "contactPerson": "Mary Dairy", "phone": "555-987-6543", "email": "mary@dairybest.com", "address": "456 Milk Road", "supplies": "Milk, Cheese, Eggs" }
            },
            lastSupplierId: 2
        };
        const db = new Low(adapter, defaultData);
        await db.read();
        db.data = db.data || defaultData;
        await db.write();

        const app = express();
        app.use(cors({ origin: '*' }));
        app.use(express.json());
        
        app.get('/suppliers', (req, res) => {
            res.json(db.data.suppliers);
        });

        app.post('/suppliers', async (req, res) => {
            const newId = ++db.data.lastSupplierId;
            const newSupplierId = `SUP-${String(newId).padStart(4, '0')}`;
            db.data.suppliers[newSupplierId] = req.body;
            await db.write();
            log(`New supplier created: ${req.body.name} (${newSupplierId})`);
            res.status(201).json({ message: 'Supplier created.' });
        });

        app.put('/suppliers/:id', async (req, res) => {
            const { id } = req.params;
            if (!db.data.suppliers[id]) {
                return res.status(404).json({ message: 'Supplier not found.' });
            }
            db.data.suppliers[id] = { ...db.data.suppliers[id], ...req.body };
            await db.write();
            log(`Supplier ${id} updated.`);
            res.json({ message: 'Supplier updated.' });
        });

        app.delete('/suppliers/:id', async (req, res) => {
            const { id } = req.params;
            if (!db.data.suppliers[id]) {
                return res.status(404).json({ message: 'Supplier not found.' });
            }
            delete db.data.suppliers[id];
            await db.write();
            log(`Supplier ${id} deleted.`);
            res.json({ message: 'Supplier deleted.' });
        });
        
        app.post('/shutdown', (req, res) => {
            log('Shutdown signal received. Exiting.');
            res.status(200).send({ message: 'Shutting down.' });
            process.exit(0);
        });

        const PORT = 3004;
        app.listen(PORT, () => {
            log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        log(`FATAL: Failed to start server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

