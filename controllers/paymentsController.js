const db = require('../config/db');
const redisClient = require('../config/redis');

const DEFAULT_EXPIRATION = 60;

// Make Payment (Manual)
exports.makePayment = (req, res) => {
    const { household_id, amount_paid, payment_method, transaction_id } = req.body;
    const sql = 'INSERT INTO payments (household_id, amount_paid, payment_method, transaction_id) VALUES (?, ?, ?, ?)';
    db.query(sql, [household_id, amount_paid, payment_method, transaction_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Payment successful', paymentId: result.insertId });
    });
};

////.........Get households by ID........////
exports.getPaymentById = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM payments WHERE household_id = ? ORDER BY created_at DESC`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving household");
        }
       return res.status(200).json(results);
    });
};

////.........Get Estate by ID........////
exports.getPaymentByEstateId = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM payments WHERE estate_id = ? ORDER BY created_at DESC`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving estate");
        }
       return res.status(200).json(results);
    });
};

// Get All Payments
exports.getAllPayments = (req, res) => {
    const sql = 'SELECT * FROM payments ORDER BY created_at DESC';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
};

///-----Query Estate ---////
exports.getEstateQueryPayments= async (req, res) => {
    const estate_id = req.params.id;
    const {query} = req.query;
    let sql = 'SELECT * FROM payments WHERE estate_id = ?';
    if (query === 'today') {
        sql += ' AND DATE(payment_date) = CURDATE()';
    } else if (query === 'yesterday') {
        sql += ' AND DATE(payment_date) = CURDATE() - INTERVAL 1 DAY';
    } else if (query === 'week') {
        sql += ' AND WEEK(payment_date) = WEEK(CURDATE())';
    } else if (query === 'month') {
        sql += ' AND MONTH(payment_date) = MONTH(CURDATE())';
    }else if (query === 'year') {
        sql += ' AND YEAR(payment_date) = YEAR(CURDATE())';
    }
    db.query(sql, [estate_id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });;
        }
       return res.status(200).json(results);
    });
};

///-----Query Households ---////
exports.getUserQueryPayments= async (req, res) => {
    const household_id = req.params.id;
    const {query} = req.query;

    let sql = 'SELECT * FROM payments WHERE household_id = ?';

    if (query === 'today') {
        sql += ' AND DATE(payment_date) = CURDATE()';
    } else if (query === 'yesterday') {
        sql += ' AND DATE(payment_date) = CURDATE() - INTERVAL 1 DAY';
    } else if (query === 'week') {
        sql += ' AND WEEK(payment_date) = WEEK(CURDATE())';
    } else if (query === 'month') {
        sql += ' AND MONTH(payment_date) = MONTH(CURDATE())';
    }

    db.query(sql, [household_id], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });;
        }
       return res.status(200).json(results);
    });
};

// Search households by estate ID and keyword
exports.searchHouseholdsId = async (req, res) => {
    const household_id = req.params.id;
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    const cacheKey = `payments/:${household_id}/:${query}`;

    try {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            return res.status(200).json(JSON.parse(cachedResults));
        }

        const sql = `
            SELECT * FROM payments 
            WHERE household_id = ? AND (
                estate_name LIKE ? OR
                transaction_id LIKE ? OR
                transaction_type LIKE ?
            )
        `;
        const searchPattern = `%${query}%`;

        db.query(sql, [household_id, searchPattern, searchPattern, searchPattern], async (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No matching payments found' });
            }

            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            return res.json({ message: 'Search results', data: results });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

// Search households by estate ID and keyword
exports.searchEstateId = async (req, res) => {
    const estate_id = req.params.id;
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    const cacheKey = `payments/:${estate_id}/:${query}`;

    try {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            return res.status(200).json(JSON.parse(cachedResults));
        }

        const sql = `
            SELECT * FROM payments 
            WHERE estate_id = ? AND (
                estate_name LIKE ? OR
                transaction_id LIKE ? OR
                transaction_type LIKE ?
            )
        `;
        const searchPattern = `%${query}%`;

        db.query(sql, [estate_id, searchPattern, searchPattern, searchPattern], async (err, results) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No matching payments found' });
            }

            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            return res.json(results);
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
};

////......Search AllPayments...../////
exports.searchAllPayments = async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).send("Search query is required");
    }

    const cacheKey = `search:AllPayments:${query}`;

    try {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            return res.status(200).json(JSON.parse(cachedResults));
        }

        let sql = `
            SELECT estate_name, transaction_id, transaction_type
            FROM Payments
            WHERE MATCH(estate_name, transaction_id, transaction_type) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        db.query(sql, query, async (err, results) => {
            if (err) {
                return res.status(500).send("Error searching posts");
            }

            await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
            return res.status(200).json(results);
        });
    } catch (error) {
        return res.status(500).send("Server error");
    }
};

// GET /api/payments/summary/:estateId
exports.getPaymentSummaryByEstate = (req, res) => {
    const estateId = req.params.estateId;

    const sql = `
        SELECT 
            ps.household_id,
            h.primary_owner,
            ps.month,
            ps.year,
            ps.total_paid
        FROM payments_summary ps
        JOIN households h ON h.household_id = ps.household_id
        WHERE h.estate_id = ?
        ORDER BY h.household_id, ps.year, ps.month
    `;

    db.query(sql, [estateId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve summary' });
        }
        res.status(200).json(results);
    });
};

// ==========================================
// NEW: STK PUSH FOR INVOICES & SUBSCRIPTIONS
// ==========================================

exports.stkPushSubscription = async (req, res) => {
    let { phone_number, estate_id, invoice_id, amount } = req.body;

    try {
        // ========================================================
        // THE FIX: Force the amount from the database
        // ========================================================
        if (invoice_id) {
            const [[invoice]] = await db.promise().query(
                `SELECT amount FROM estate_invoices WHERE invoice_id = ?`,
                [invoice_id]
            );
            
            if (invoice) {
                amount = invoice.amount; 
                console.log(`📡 STK Push: Forcing Invoice Amount: ${amount}`);
            } else {
                return res.status(404).json({ error: "Invoice not found" });
            }
        } else {
            console.log(`📡 STK Push: Subscription Payment Amount: ${amount}`);
        }

        // Mock M-Pesa response
        const mpesaResponse = {
            ResponseCode: "0",
            CheckoutRequestID: "ws_CO_" + Date.now(),
            MerchantRequestID: "merchant_" + Date.now()
        };

        if (mpesaResponse.ResponseCode === "0") {
            // 2. Save the pending push to the database
            await db.promise().query(
                `INSERT INTO pending_stk_pushes 
                   (checkout_request_id, merchant_request_id, household_id, estate_id, phone, amount, invoice_id, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
                [
                    mpesaResponse.CheckoutRequestID, 
                    mpesaResponse.MerchantRequestID, 
                    0, 
                    estate_id, 
                    phone_number, 
                    amount, // Saved as 1000 for invoices
                    invoice_id || null 
                ]
            );
            
            return res.json(mpesaResponse);
        } else {
            return res.status(400).json(mpesaResponse);
        }
    } catch (error) {
        console.error("STK Push error:", error);
        return res.status(500).json({ error: "Failed to initiate STK push" });
    }
};

exports.mpesaCallback = async (req, res) => {
    try {
        const callbackData = req.body.Body.stkCallback;
        const { CheckoutRequestID, ResultCode, ResultDesc } = callbackData;

        if (ResultCode === 0) {
            // 1. Find the pending push
            const [[pending]] = await db.promise().query(
                `SELECT invoice_id, estate_id, amount FROM pending_stk_pushes WHERE checkout_request_id = ?`,
                [CheckoutRequestID]
            );

            if (pending) {
                // Get M-Pesa Receipt Number
                const transactionId = callbackData.CallbackMetadata.Item.find(item => item.Name === 'MpesaReceiptNumber')?.Value || CheckoutRequestID;

                // 2. Record it in the general payments table
                await db.promise().query(
                    `INSERT INTO payments 
                       (estate_id, amount_paid, payment_method, payment_status, payment_date, transaction_id, notes) 
                     VALUES (?, ?, 'M-Pesa', 'Completed', NOW(), ?, ?)`,
                    [pending.estate_id, pending.amount, transactionId, pending.invoice_id ? `Invoice #${pending.invoice_id}` : 'Subscription']
                );

                // 3. If it was for an invoice, update the invoice!
                if (pending.invoice_id) {
                    await db.promise().query(
                        `UPDATE estate_invoices 
                         SET status = 'Paid', 
                             paid_at = NOW(), 
                             paid_amount = ?, 
                             payment_method = 'M-Pesa', 
                             transaction_id = ? 
                         WHERE invoice_id = ?`,
                        [pending.amount, transactionId, pending.invoice_id]
                    );
                } 
                // 4. If it was NOT an invoice, it's a subscription payment. Update the subscription!
                else {
                    // Find their current plan, or default to plan 1
                    const [[currentSub]] = await db.promise().query(
                        `SELECT plan_id FROM estate_subscriptions WHERE estate_id = ? LIMIT 1`,
                        [pending.estate_id]
                    );
                    const planId = currentSub ? currentSub.plan_id : 1;

                    // Upsert the subscription: Mark Paid, Active, and extend for 30 days
                    await db.promise().query(
                        `INSERT INTO estate_subscriptions 
                           (estate_id, plan_id, start_date, end_date, amount_paid, payment_status, payment_method, transaction_id, is_active) 
                         VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), ?, 'Paid', 'M-Pesa', ?, 1)
                         ON DUPLICATE KEY UPDATE 
                           start_date = NOW(),
                           end_date = DATE_ADD(NOW(), INTERVAL 30 DAY),
                           amount_paid = VALUES(amount_paid),
                           payment_status = 'Paid',
                           payment_method = 'M-Pesa',
                           transaction_id = VALUES(transaction_id),
                           is_active = 1`,
                        [pending.estate_id, planId, pending.amount, transactionId]
                    );
                }

                // 5. Mark push as completed
                await db.promise().query(
                    `UPDATE pending_stk_pushes SET status = 'Completed' WHERE checkout_request_id = ?`,
                    [CheckoutRequestID]
                );
            }
        } else {
            // Payment failed
            await db.promise().query(
                `UPDATE pending_stk_pushes SET status = 'Failed' WHERE checkout_request_id = ?`,
                [CheckoutRequestID]
            );
        }

        // Always respond with 200 to stop Safaricom retrying
        res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
    } catch (error) {
        console.error("Callback error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};