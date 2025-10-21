import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const log = (message) => {
    const logData = { service: 'Inventory Service', message: message };
    process.stdout.write(`LOG::${JSON.stringify(logData)}\n`);
};

const startServer = async () => {
    try {
        const adapter = new JSONFile('inventory_db.json');
        const defaultData = {
            products: {
                "1001": { "name": "Whole Milk", "price": 140.00, "cost": 110.00, "stock": 100, "lowStockThreshold": 20, "supplierId": "SUP-0002" },
                "1002": { "name": "White Bread", "price": 45.00, "cost": 30.00, "stock": 80, "lowStockThreshold": 15, "supplierId": "" },
                "1003": { "name": "Eggs (Dozen)", "price": 70.00, "cost": 55.00, "stock": 10, "lowStockThreshold": 12, "supplierId": "SUP-0002" },
                "1004": { "name": "Cheddar Cheese", "price": 250.00, "cost": 210.00, "stock": 60, "lowStockThreshold": 10, "supplierId": "SUP-0002" }
            },
            lastSku: 1004
        };
        const db = new Low(adapter, defaultData);
        await db.read();

        if (!db.data || !db.data.products || Object.keys(db.data.products).length === 0) {
            log('Inventory database is empty. Seeding with default data.');
            db.data = defaultData;
            await db.write();
        }

        const app = express();
        app.use(cors({ origin: '*' }));
        app.use(express.json());
        
        app.get('/products', (req, res) => {
            res.json(db.data.products);
        });

        app.get('/products/low-stock', (req, res) => {
            const lowStockItems = Object.entries(db.data.products)
                .filter(([sku, product]) => product.stock <= (product.lowStockThreshold || 20));
            res.json(Object.fromEntries(lowStockItems));
        });
        
        app.post('/products', async (req, res) => {
            const { name, price, cost, stock, lowStockThreshold, supplierId } = req.body;
            const newSku = ++db.data.lastSku;
            db.data.products[newSku] = { name, price: parseFloat(price), cost: parseFloat(cost), stock: parseInt(stock), lowStockThreshold: parseInt(lowStockThreshold) || 20, supplierId };
            await db.write();
            log(`Product '${name}' added with new SKU ${newSku}.`);
            res.status(201).json({ message: 'Product added.' });
        });

        app.put('/products/:sku', async (req, res) => {
            const { sku } = req.params;
            const { name, price, cost, stock, lowStockThreshold, supplierId } = req.body;
            if (!db.data.products[sku]) { return res.status(404).json({ message: 'Product not found.' }); }
            db.data.products[sku] = { name, price: parseFloat(price), cost: parseFloat(cost), stock: parseInt(stock), lowStockThreshold: parseInt(lowStockThreshold) || 20, supplierId };
            await db.write();
            log(`Product SKU '${sku}' updated.`);
            res.json({ message: 'Product updated.' });
        });

        app.delete('/products/:sku', async (req, res) => {
            const { sku } = req.params;
            if (!db.data.products[sku]) { return res.status(404).json({ message: 'Product not found.' }); }
            delete db.data.products[sku];
            await db.write();
            log(`Product SKU '${sku}' deleted.`);
            res.json({ message: 'Product deleted.' });
        });

        app.post('/update-stock', async (req, res) => {
            const { stockUpdates } = req.body;
            for (const update of stockUpdates) {
                if (db.data.products[update.sku]) {
                    db.data.products[update.sku].stock += update.change;
                    log(`Stock for SKU '${update.sku}' adjusted by ${update.change}. New stock: ${db.data.products[update.sku].stock}`);
                }
            }
            await db.write();
            res.status(200).json({ message: 'Stock updated.' });
        });

        app.post('/shutdown', (req, res) => {
            log('Shutdown signal received. Exiting.');
            res.status(200).send({ message: 'Shutting down.' });
            process.exit(0);
        });

        const PORT = 3002;
        app.listen(PORT, () => {
            log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        log(`FATAL: Failed to start server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

