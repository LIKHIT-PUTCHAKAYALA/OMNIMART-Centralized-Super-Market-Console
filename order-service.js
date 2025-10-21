import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import fetch from 'node-fetch';

const log = (message) => {
    const logData = { service: 'Order Service', message: message };
    process.stdout.write(`LOG::${JSON.stringify(logData)}\n`);
};

const INVENTORY_SERVICE_URL = 'http://localhost:3002';
const AUTH_SERVICE_URL = 'http://localhost:3001';

const getTodayDateString = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

const startServer = async () => {
    try {
        const adapter = new JSONFile('orders_db.json');
        const defaultData = { 
            orders: [], 
            lastOrderCounters: {}
        };
        const db = new Low(adapter, defaultData);
        await db.read();
        db.data = db.data || defaultData;
        if (!db.data.lastOrderCounters) db.data.lastOrderCounters = {};
        await db.write();

        const app = express();
        app.use(cors({ origin: '*' }));
        app.use(express.json());
        
        app.get('/orders', (req, res) => {
            const validOrders = db.data.orders.filter(order => order && order.orderId);
            const sortedOrders = validOrders.slice().sort((a, b) => {
                if (a.orderId && b.orderId) {
                    return b.orderId.localeCompare(a.orderId);
                }
                return 0;
            });
            res.json(sortedOrders);
        });

        app.post('/orders', async (req, res) => {
            const today = getTodayDateString();
            if (!db.data.lastOrderCounters[today]) {
                db.data.lastOrderCounters[today] = 0;
            }
            const newCounter = ++db.data.lastOrderCounters[today];
            const newOrderId = `#ORD-${today}-${String(newCounter).padStart(4, '0')}`;

            const newOrder = { orderId: newOrderId, timestamp: new Date().toISOString(), status: 'COMPLETED', ...req.body };
            db.data.orders.push(newOrder);
            await db.write();

            const stockUpdates = newOrder.items.filter(item => item.sku && !item.sku.startsWith('CUSTOM-')).map(item => ({ sku: item.sku, change: -item.qty }));
            if (stockUpdates.length > 0) {
                 await fetch(`${INVENTORY_SERVICE_URL}/update-stock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stockUpdates })
                });
            }

            if(newOrder.customerDetails && newOrder.customerDetails.id) {
                const points = Math.floor(newOrder.total / 100);
                if (points > 0) {
                    await fetch(`${AUTH_SERVICE_URL}/users/${newOrder.customerDetails.id}/points`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ points })
                    });
                }
            }

            log(`New order ${newOrderId} created by ${newOrder.user.name}.`);
            res.status(201).json(newOrder);
        });
        
        app.put('/orders/:orderId', async (req, res) => {
            const orderIdParam = req.params.orderId.startsWith('#') ? req.params.orderId : `#${req.params.orderId}`;
            const updatedOrderData = req.body;
            const orderIndex = db.data.orders.findIndex(o => o && o.orderId === orderIdParam);
            
            if (orderIndex === -1) {
                return res.status(404).json({ message: 'Order not found.' });
            }
            
            const originalOrder = db.data.orders[orderIndex];

            const originalItemsMap = new Map(originalOrder.items.map(i => [i.sku, i.qty]));
            const updatedItemsMap = new Map(updatedOrderData.items.map(i => [i.sku, i.qty]));
            const stockChanges = new Map();

            originalItemsMap.forEach((qty, sku) => { 
                if (sku && !sku.startsWith('CUSTOM-')) stockChanges.set(sku, (stockChanges.get(sku) || 0) + qty); 
            });
            updatedItemsMap.forEach((qty, sku) => { 
                if (sku && !sku.startsWith('CUSTOM-')) stockChanges.set(sku, (stockChanges.get(sku) || 0) - qty); 
            });
            
            const stockUpdates = Array.from(stockChanges.entries()).map(([sku, change]) => ({ sku, change }));

            if(stockUpdates.length > 0) {
                await fetch(`${INVENTORY_SERVICE_URL}/update-stock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stockUpdates })
                });
            }
            
            db.data.orders[orderIndex] = { ...originalOrder, ...updatedOrderData, status: 'EDITED' };
            await db.write();
            log(`Order ${orderIdParam} has been edited.`);
            res.json({ message: 'Order updated successfully' });
        });
        
        app.post('/orders/:orderId/cancel', async (req, res) => {
            const orderIdParam = req.params.orderId.startsWith('#') ? req.params.orderId : `#${req.params.orderId}`;
            const order = db.data.orders.find(o => o && o.orderId === orderIdParam);
            
            if (!order || order.status === 'CANCELLED') { 
                return res.status(404).json({ message: 'Order not found or already cancelled.' }); 
            }

            const stockUpdates = order.items.filter(item => item.sku && !item.sku.startsWith('CUSTOM-')).map(item => ({ sku: item.sku, change: item.qty }));
            
            if(stockUpdates.length > 0){
                await fetch(`${INVENTORY_SERVICE_URL}/update-stock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stockUpdates })
                });
            }

            order.status = 'CANCELLED';
            await db.write();
            log(`Order ${orderIdParam} cancelled.`);
            res.json({ message: 'Order cancelled and items restocked.' });
        });

        app.delete('/orders/:orderId', async (req, res) => {
            const orderIdParam = req.params.orderId.substring(1); // Remove '#' for fetching
            const orderIndex = db.data.orders.findIndex(o => o && o.orderId === `#${orderIdParam}`);

            if (orderIndex === -1) {
                return res.status(404).json({ message: 'Order not found.' });
            }

            const order = db.data.orders[orderIndex];
            
            if (order.status !== 'CANCELLED') {
                const stockUpdates = order.items
                    .filter(item => item.sku && !item.sku.startsWith('CUSTOM-'))
                    .map(item => ({ sku: item.sku, change: item.qty }));
                
                if(stockUpdates.length > 0){
                    try {
                        await fetch(`${INVENTORY_SERVICE_URL}/update-stock`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ stockUpdates })
                        });
                        log(`Stock replenished for deleted order ${order.orderId}.`);
                    } catch (e) {
                        log(`ERROR: Failed to replenish stock for deleted order ${order.orderId}. Error: ${e.message}`);
                    }
                }
            }

            db.data.orders.splice(orderIndex, 1);
            await db.write();
            log(`Order ${order.orderId} permanently deleted.`);
            res.json({ message: 'Order permanently deleted.' });
        });

        app.get('/stats', async (req, res) => {
            const completedOrders = db.data.orders.filter(o => o && (o.status === 'COMPLETED' || o.status === 'EDITED'));
            
            const salesByCashier = completedOrders.reduce((acc, order) => {
                if (order.user && order.user.name) { 
                    const cashier = order.user.name;
                    acc[cashier] = (acc[cashier] || 0) + 1;
                }
                return acc;
            }, {});

            const salesByHour = completedOrders.reduce((acc, order) => {
                const hour = new Date(order.timestamp).getHours();
                const hourLabel = `${String(hour).padStart(2, '0')}:00`;
                acc[hourLabel] = (acc[hourLabel] || 0) + 1;
                return acc;
            }, {});

            const productsRes = await fetch(`${INVENTORY_SERVICE_URL}/products`);
            const products = await productsRes.json();
            const profitByItem = completedOrders.flatMap(o => o.items).reduce((acc, item) => {
                 if (item && item.sku && !item.sku.startsWith('CUSTOM-') && products[item.sku]) {
                    const product = products[item.sku];
                    const profit = (product.price - product.cost) * item.qty;
                    acc[product.name] = (acc[product.name] || 0) + profit;
                 }
                 return acc;
            }, {});
            
            res.json({
                totalRevenue: completedOrders.reduce((sum, o) => sum + o.total, 0), 
                totalSales: completedOrders.length,
                salesByCashier: Object.entries(salesByCashier).map(([name, sales]) => ({ name, sales })),
                salesByHour: Object.entries(salesByHour).map(([name, sales]) => ({ name, sales })).sort((a,b) => a.name.localeCompare(b.name)),
                profitByItem: Object.entries(profitByItem).map(([name, profit]) => ({ name, profit })).sort((a,b) => b.profit - a.profit).slice(0, 10),
            });
        });
        
        app.post('/shutdown', (req, res) => {
            log('Shutdown signal received. Exiting.');
            res.status(200).send({ message: 'Shutting down.' });
            process.exit(0);
        });

        const PORT = 3003;
        app.listen(PORT, () => {
            log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        log(`FATAL: Failed to start server: ${error.message}`);
        process.exit(1);
    }
};

startServer();

