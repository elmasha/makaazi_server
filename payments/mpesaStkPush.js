const express = require("express");
const request = require("request");
const bodyParser = require("body-parser");
const router = express.Router();
const cors = require("cors");
const db = require('../config/db');
const moment = require('moment');
const { sendNotification } = require("../utils/notify");

// Utility function to get lowercase month name
function getMonthColumn(date) {
    return moment(date).format('MMM').toLowerCase(); // e.g., 'jan', 'feb'
}

function getYearColumn(date) {
    return moment(date).format('YYYY'); // e.g., 'jan', 'feb'
}


///-----Port-----///
const _urlencoded = express.urlencoded({ extended: false });
router.use(cors());
router.use(express.json());
router.use(express.static("public"));



//----AllOW ACCESS -----//
router.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
    return res.status(200).json({});
  }

  next();
});


router.get("/", (req, res, next) => {
  res.status(200).send({ message: "payments" });
});

////-----ACCESS_TOKEN-----
router.get("/access_token", access, (req, res) => {
    res.status(200).json({ access_token: req.access_token });
});

let estate_id ;   

let _checkoutRequestId,
    _UserID,
    UID,
    Username,
    Subscription,
    _Amount,
    _phoneNumber,
    _UserType,
    member_id,
    month,
    year,
    household_id,
    charge_id,    
    estate_name,
    payment_amount,
    balance_brought_forward,
    total_paid,
    due_year_to_date,
    overdue,
    months_equivalent,
    payment_date,
    transaction_type;

 

//----StkPush ----///
router.post("/mpesa_stk_push", access, _urlencoded,  function(req, res) {
    _phoneNumber = req.body.phone;
    _Amount = req.body.amount;
    _UserID = req.body.user_id;
    UID = req.body.uid; 
    Username = req.body.user_name;
    Subscription = req.body.subscription;

    // New user data to include
    transaction_type = req.body.transaction_type;
    month = req.body.month;
    year = req.body.year;
    household_id = req.body.household_id;
    charge_id = req.body.charge_id;
    estate_id = req.body.estate_id;
    estate_name = req.body.estate_name;
    payment_amount = req.body.payment_amount;
    balance_brought_forward = req.body.balance_brought_forward;
    total_paid = req.body.total_paid;
    due_year_to_date = req.body.due_year_to_date;
    overdue = req.body.overdue;
    months_equivalent = req.body.months_equivalent;
    payment_date = req.body.payment_date;
    

    let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
    let auth = "Bearer " + req.access_token;

    let _shortCode = `174379`;
    let _passKey = `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`;

    const timeStamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, -3);
    const password = Buffer.from(`${_shortCode}${_passKey}${timeStamp}`).toString("base64");

    request({
            url: endpoint,
            method: "POST",
            headers: {
                Authorization: auth,
            },
            json: {
                BusinessShortCode: _shortCode,
                Password: password,
                Timestamp: timeStamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: _Amount,
                PartyA: _phoneNumber,
                PartyB: _shortCode,
                PhoneNumber: _phoneNumber,
                CallBackURL:'https://makaaziserver22.up.railway.app/payment/stk_callback',
                AccountReference: "INTEC Makaazi Payment sandbox",
                TransactionDesc: "Make payment to SCM router of INTEC",
            }, 
        },
        (error, response, body) => {
            if (error) {
                console.log(error);
                res.status(404).json(error);
            } else {
                res.status(200).json(body);
                console.log(body);
                console.log(Username ,"UID => "+UID);
            }
        }
    );
});
///--End-->>>
const middleware = (req, res, next) => {
    req.checkoutID = _checkoutRequestId;
    req.uid = _UserID;
    req.name = Username;
    req.amount = _Amount;
    req.subscribe = Subscription;
    req.user_type = _UserType;
    next();
};
var transID ,amount,transdate,transNo;
//---STk CalBack ---///




router.post("/stk_callback", async function(req, res) {
    console.log(".......... STK Callback ..................");

    const callback = req.body.Body?.stkCallback;
    const metadata = callback?.CallbackMetadata;

    if (callback?.ResultCode !== 0 || !metadata) {
        return res.status(400).json({ error: "Invalid callback data" });
    }

    const amount = metadata.Item.find(i => i.Name === "Amount")?.Value;
    const transID = metadata.Item.find(i => i.Name === "MpesaReceiptNumber")?.Value;
    const phoneNumber = metadata.Item.find(i => i.Name === "PhoneNumber")?.Value;
    const transdate = new Date();

    // Retrieve metadata using CheckoutRequestID
    const metaKey = callback.CheckoutRequestID || "fallback-key";

    
    const sql = `
        INSERT INTO payments (
            household_id, charge_id, payment_date, amount_paid,
            payment_method, transaction_id, receipt_url, payment_status,estate_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,?)
    `;

    const values = [
        household_id,
        charge_id,
        transdate,
        amount,
        "Mpesa",
        transID,
        null, // receipt_url will be generated later if needed
        "Completed",
        estate_id
    ];

    db.query(sql, values, async (err, result) => {
        if (err) {
            console.error("❌ Error saving payment:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        console.log("✅ Payment saved:", result);

        await sendNotification({
        user_uid: _UserID,
        user_type: "ESTATE",
        title: "Payment Received",
        message: "Payment has been received successfully.",
        type: "PAYMENT",
        });
        delete paymentMetaStore[metaKey]; // Clean up temp metadata
        res.status(200).json({ message: "Payment saved successfully" });
    });
});





router.post('/trans_status', access ,(req,res,next) =>{
    var  _mpesaReceipt = req.body.mpesaID;//amount
    let dev_shortCode = "600977";
    _UserID = req.body.uid;
     let endpoint = "https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query";
   
     let auth = 'Bearer '+ req.access_token;
    var  _securityCredentials = "FVM4uU5+SbmPxKNkGsOOYYXoFkSJ2Rk4lht+vowd2vejeNiN9YFEOpW7QW5MAbZlxfrN1rmd3TuM/RhhtGOXVuZstn6AhsDi+NHWaPjuqFtdi23YEofBwmQNUSmRAj06CLQm6qdXYVsrPffS4pIhwa6IyWAEjKtvPeaUdbWC/9wxlmZeMnQbpivpiYeUDJcBQcZ9TbdnQNGPGYJ5JUvtJOTHmkaMEADrV/5X3AGdi1HliKTBBTtvM5PcBQorr43VUWc7o1Ubaxj2c/eAcItsXa/jNpN7dc0s4Lgz+qUp2iAoCd5zOgPrXZQPJuY6Z/VOABfNNEPo/A0m9RXHx/GI1A==";///Put security credentials
     request(
         {
             url:endpoint,
             method :"POST",
             headers:{
             "Authorization": auth
             },
             json:{
                "Initiator":"testapi", 
                "SecurityCredential":_securityCredentials,              
                "CommandID": "TransactionStatusQuery",
                "TransactionID": _mpesaReceipt,
                "PartyA":dev_shortCode,
                "IdentifierType":"4",
                "QueueTimeOutURL":"https://makaaziserver22.up.railway.app/payment/timeout_status",
                "ResultURL":"https://makaaziserver22.up.railway.app/payment/result_status",
                "Remarks":"OK",
                "Occasion":"OK",
             }
         },
         function(error,response,body){
             if(error){
                 console.log(error);
                 res.status(404);//404 response status
             }
                 res.status(200).json(body)//200 response status
                 console.log(body)
   
         }
     )
   
   })

   router.post('/timeout_status', function(req, res,next) {
    console.log('.......... Timeout status ..................')
    console.log(req.body);
    return  res.status(200).json(req.body.Body);
  })
  
  
  router.post('/result_status',  function(req, res,next) {
    console.log('.......... Results status..................')
    let _UID = req.uid;
  //   console.log(req.body.Result.TransactionID);
     console.log(req.body.Result);
  //   console.log(req.body.Result.ResultDesc);
  
    const { ResultParameter } = req.body.Result;
  
//     const getValueByKey = (key) => {
//       const result = ResultParameter.find(param => param.Key === key);
//       return result ? result.Value : null;
//     };
  
//    // Example usage: Retrieving the TransactionAmount value
//    const transactionAmount = getValueByKey('TransactionAmount');
//    const transactionReceipt = getValueByKey('TransactionReceipt');
  
    
   // Now 'transactionAmount' holds the value of 'TransactionAmount' key
  // console.log('Transaction Amount:', ResultParameter);
  
    // if(req.body.Body.ResultCode == 0){
    // //   var sfDocRefWhole = db.collection("Charge24_users").doc(_UID);
  
    // //   return db.runTransaction((transaction) => {
    // //             return transaction.get(sfDocRefWhole).then((sfDoc) => {
    // //                 if (!sfDoc.exists) {
    // //                     throw "Document does not exist!";
    // //                 }
    // //                 transaction.delete(sfDocRefWhole);
  
    // //             });
    // //         })
    // //         .then(() => {
    // //             console.log("Account deleted ");
    // //         })
    // //         .catch((err) => {
    // //             // This will be an "population is too big" error.
    // //             console.error(err);
    // //         });
  
    // }
    return  res.status(200).json(req.body);
  })





const updatePaymentSummary = () => {
 
};


function createPaymentSummary(res) {
    const insertSql = `
      INSERT INTO household_payments (
        household_id, estate_id, full_name, balance_brought_forward, created_at, updated_at
      ) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    db.query(insertSql, [household_id, estate_id, Username], (err, result) => {
      if (err) {
        console.error("❌ Error creating household_payments:", err.message);
        return res.status(500).json({ error: "Error creating payment summary" });
      }
      console.log("🆕 New payment summary record created!");
      // Now update the payment
      updatePaymentSummary(res);
    });
  }



router.post("/callback", _urlencoded, (req, res) =>{

    console.log(".......... STK Callback ..................");
    if (res.status(200)) {
    
            //-----WholeSeller Start---/////

            res.json(req.body.Body.stkCallback.CallbackMetadata);
            console.log(req.body.Body.stkCallback.CallbackMetadata);

            if (
                (Balance =
                    req.body.Body.stkCallback.CallbackMetadata.Item[2].Name == "Balance")
            ) {
                amount = req.body.Body.stkCallback.CallbackMetadata.Item[0].Value;
                transID = req.body.Body.stkCallback.CallbackMetadata.Item[1].Value;
                transNo = req.body.Body.stkCallback.CallbackMetadata.Item[4].Value;
                transdate = req.body.Body.stkCallback.CallbackMetadata.Item[3].Value;


                 // Store payment data to the database
            const sql = `
            INSERT INTO payments (
                transaction_type, month, year, household_id, charge_id, estate_id, estate_name, 
                payment_amount, balance_brought_forward, total_paid, due_year_to_date, 
                overdue, months_equivalent, payment_date, transaction_id, transaction_date, transaction_number
            ) VALUES (?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            transaction_type,month, year, household_id, charge_id, estate_id, estate_name,
            payment_amount, balance_brought_forward, total_paid, due_year_to_date,
            overdue, months_equivalent, payment_date, transID, transdate, transNo
        ];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error("Error saving payment data:", err.message);
                return res.status(500).json({ error: "Database error" });
            }
            console.log("Payment saved successfully:", result);
            res.status(200).json({ message: "Payment saved successfully" });
        });

                
            } else {
                amount = req.body.Body.stkCallback.CallbackMetadata.Item[0].Value;
                transID = req.body.Body.stkCallback.CallbackMetadata.Item[1].Value;
                transNo = req.body.Body.stkCallback.CallbackMetadata.Item[3].Value;
                transdate = req.body.Body.stkCallback.CallbackMetadata.Item[2].Value;


                 // Store payment data to the database
            const sql = `
            INSERT INTO payments (transaction_type,
                 month, year, household_id, charge_id, estate_id, estate_name, 
                payment_amount, balance_brought_forward, total_paid, due_year_to_date, 
                overdue, months_equivalent, payment_date, transaction_id, transaction_date, transaction_number
            ) VALUES ( ?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            transaction_type,month, year, household_id, charge_id, estate_id, estate_name,
            payment_amount, balance_brought_forward, total_paid, due_year_to_date,
            overdue, months_equivalent, payment_date, transID, transdate, transNo
        ];

        db.query(sql, values, async (err, result) => {
            if (err) {
                console.error("Error saving payment data:", err.message);
                return res.status(500).json({ error: "Database error" });
            }
             await sendNotification({
            user_uid: _UserID, // Assuming estate_id can be used as user_uid
            user_type: "USER",
            title: "Payment Received",
            message: "Your payment has been received successfully.",
            type: "PAYMENT",
            });
            console.log("Payment saved successfully:", result);
           return res.status(200).json({ message: "Payment saved successfully" });
        });

                
            }

        
        
    } else if (res.status(404)) {
        res.json(req.body);
    }
});

//----End Callback -->>>>



//----STK QUERY ---


router.post(
    "/mpesa_stk_push/query",
    access,
    _urlencoded,
    middleware,
    function(req, res, next) {
        let _checkoutRequestId = req.body.checkoutRequestId;

        auth = "Bearer " + req.access_token;

        let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query";
        let _shortCode = "174379";
        let _passKey =
            "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
        const timeStamp = new Date()
            .toISOString()
            .replace(/[^0-9]/g, "")
            .slice(0, -3);
        const password = Buffer.from(
            `${_shortCode}${_passKey}${timeStamp}`
        ).toString("base64");

        request({
                url: endpoint,
                method: "POST",
                headers: {
                    Authorization: auth,
                },

                json: {
                    BusinessShortCode: _shortCode,
                    Password: password,
                    Timestamp: timeStamp,
                    CheckoutRequestID: _checkoutRequestId,
                },
            },
            function(error, response, body) {
                if (error) {
                    console.log(error);
                    res.status(404).json(body);
                } else {
                    var resDesc = body.ResponseDescription;

                    if (res.status(200)) {
                        res.status(200).json(body);
                        var resDesc = body.ResponseDescription;
                        var resultDesc = body.ResultDesc;
                        console.log("Query Body", body);
                    }

                    next();
                }
            }
        );
    }
);




function createPaymentAndReceipt  (req, res) {
    const {
        member_id,
        month,
        year,
        household_id,
        charge_id,
        estate_id,
        estate_name,
        payment_amount,
        balance_brought_forward,
        total_paid,
        due_year_to_date,
        overdue,
        months_equivalent,
        payment_date
    } = req.body;

    // Validate required fields
    if (!household_id || !estate_id || !payment_amount || !payment_date) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get a database connection
    db.getConnection((err, connection) => {
        if (err) {
            console.error('Database connection error:', err.message);
            return res.status(500).json({ error: 'Database connection error' });
        }

        // SQL for inserting payment
        const sql = `
            INSERT INTO payments (
                member_id, month, year, household_id, charge_id, estate_id, estate_name, 
                payment_amount, balance_brought_forward, total_paid, due_year_to_date, 
                overdue, months_equivalent, payment_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
            member_id, month, year, household_id, charge_id, estate_id, estate_name,
            payment_amount, balance_brought_forward, total_paid, due_year_to_date,
            overdue, months_equivalent, payment_date
        ];

        connection.query(sql, values, (err, result) => {
            connection.release();

            if (err) {
                console.error('Error inserting payment:', err.message);
                return res.status(500).json({ error: 'Error inserting payment' });
            }

            console.log('Payment created successfully');
            res.status(201).json({ message: 'Payment created successfully', payment_id: result.insertId });
        });
    });
};


function access(res, req, next) {
    let endpoint =
        "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
    let auth = new Buffer.from(
        `${process.env.MP_CONSUMER_KEY_DEV}:${process.env.MP_SECRET_KEY_DEV}`
    ).toString("base64");

    request({
            url: endpoint,
            headers: {
                Authorization: "Basic " + auth,
            },
        },
        (error, response, body) => {
            if (error) {
                console.log(error);
            } else {
                res.access_token = JSON.parse(body).access_token;
                console.log(body);
                next();
            }
        }
    );
}
function getSubscriptionRate(householdCount) {
    if (householdCount <= 20) return 1;
    if (householdCount <= 50) return 2500;
    if (householdCount <= 100) return 3000;
    return 4000;
}

let total_households,plan_id,monthly_rate;
router.post("/stk_push_subscription", access,_urlencoded, async function(req, res) {
     estate_id = req.body.estate_id;
  let  phone_number = req.body.phone_number;

    try {
        const [[{ count }]] = await db.promise().query(
            "SELECT COUNT(*) as count FROM households WHERE estate_id = ?",
            [estate_id]
        );

         // 2️⃣ Find matching plan from subscription_plans table
        const [plans] = await db.promise().query(
            `SELECT plan_id, monthly_rate 
             FROM subscription_plans 
             WHERE ? BETWEEN min_households AND max_households 
             LIMIT 1`,
            [count]
        );

        if (plans.length === 0) {
            return res.status(400).json({ error: "No matching subscription plan found" });
        }

         plan_id  = plans[0].plan_id;
        monthly_rate  = plans[0];

        total_households = count;
        console.log('Total Households:', total_households);
        const amount = getSubscriptionRate(count);
          let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
    let auth = "Bearer " + req.access_token;

    let _shortCode = `174379`;
    let _passKey = `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`;

    const timeStamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, -3);
    const password = Buffer.from(`${_shortCode}${_passKey}${timeStamp}`).toString("base64");

    request({
            url: endpoint,
            method: "POST",
            headers: {
                Authorization: auth,
            },
            json: {
                BusinessShortCode: _shortCode,
                Password: password,
                Timestamp: timeStamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: amount,
                PartyA: phone_number,
                PartyB: _shortCode,
                PhoneNumber: phone_number,
                CallBackURL:'https://makaaziserver22.up.railway.app/payment/subscription_callback',
                AccountReference: "INTEC Payment sandbox",
                TransactionDesc: "Make payment to SCM router of INTEC",
            }, 
        },
        (error, response, body) => {
            if (error) {
                console.log(error);
                res.status(404).json(error);
            } else {
                res.status(200).json(body);
                console.log('STK Body',body);
                console.log('plan id',plan_id);
                console.log('amount',amount);
                console.log('estate id',estate_id);
            }
        }
    )

    } catch (error) {
        console.error("STK error:", error.message);
        res.status(500).json({ error: "STK push failed" });
    }
});
///--End-->>>


router.post("/subscription_callback", async function (req, res) {
    console.log(".......... Subscription Callback ..................");

    const callback = req.body.Body?.stkCallback;
    const metadata = callback?.CallbackMetadata;

    if (callback?.ResultCode !== 0 || !metadata) {
        return res.status(400).json({ error: "Invalid callback data" });
    }

    const amount = metadata.Item.find(i => i.Name === "Amount")?.Value;
    const transID = metadata.Item.find(i => i.Name === "MpesaReceiptNumber")?.Value;
    const phoneNumber = metadata.Item.find(i => i.Name === "PhoneNumber")?.Value;
    const transdate = new Date();

    // Assuming these are already available in scope (you said estate_id is known)
    const billing_rate = amount; // Or calculate based on households

    // Step 1: Insert into subscription_payments
    const sql1 = `
        INSERT INTO subscription_payments (
            estate_id, total_households, billing_rate, total_amount,
            payment_method, transaction_id, payment_date, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values1 = [
        estate_id,
        total_households,
        billing_rate,
        parseFloat(amount),
        "Mpesa",
        transID,
        transdate,
        "Completed"
    ];

    db.query(sql1, values1, (err, result) => {
        if (err) {
            console.error("❌ Error saving subscription payment:", err.message);
            return res.status(500).json({ error: "Database error on subscription_payments" });
        }
        console.log("✅ Subscription payment saved:", result);

        // Step 2: Insert or update estate_subscriptions
        const sql2 = `
            INSERT INTO estate_subscriptions (
                estate_id, plan_id, start_date, end_date, amount_paid, 
                payment_status, payment_method, transaction_id, receipt_url, created_at, updated_at, is_active
            ) VALUES (?, ?, CURDATE(), NULL, ?, 'Paid', 'Mpesa', ?, NULL, NOW(), NOW(),1)
            ON DUPLICATE KEY UPDATE 
                plan_id = VALUES(plan_id),
                start_date = CURDATE(),
                end_date = NULL,
                amount_paid = VALUES(amount_paid),
                payment_status = 'Paid',
                payment_method = 'Mpesa',
                transaction_id = VALUES(transaction_id),
                updated_at = CURRENT_TIMESTAMP,
                is_active = 1
        `;

        const values2 = [
            estate_id,
            plan_id,
            parseFloat(amount),
            transID
        ];

        db.query(sql2, values2, async(err, result) => {
            if (err) {
                console.error("❌ Subscription insert/update error:", err.message);
                return res.status(500).json({ error: "Subscription update failed" });
            }
            console.log("✅ Subscription inserted or updated successfully");
            await sendNotification({
            user_uid: estate_id.toString(), // Assuming estate_id can be used as user_uid
            user_type: "ESTATE",
            title: "Subscription Payment Received",
            message: "Your subscription payment has been received successfully.",
            type: "PAYMENT",
            });
            return res.status(200).json({ message: "Subscription recorded successfully" });
        });
    });
});



router.post(
    "/stk_push_subscription/query",
    access,
    _urlencoded,
    middleware,
    function(req, res, next) {
        let _checkoutRequestId = req.body.checkoutRequestId;

        auth = "Bearer " + req.access_token;

        let endpoint = "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query";
        let _shortCode = "174379";
        let _passKey =
            "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";
        const timeStamp = new Date()
            .toISOString()
            .replace(/[^0-9]/g, "")
            .slice(0, -3);
        const password = Buffer.from(
            `${_shortCode}${_passKey}${timeStamp}`
        ).toString("base64");

        request({
                url: endpoint,
                method: "POST",
                headers: {
                    Authorization: auth,
                },

                json: {
                    BusinessShortCode: _shortCode,
                    Password: password,
                    Timestamp: timeStamp,
                    CheckoutRequestID: _checkoutRequestId,
                },
            },
            function(error, response, body) {
                if (error) {
                    console.log(error);
                    res.status(404).json(body);
                } else {
                    var resDesc = body.ResponseDescription;

                    if (res.status(200)) {
                        res.status(200).json(body);
                        var resDesc = body.ResponseDescription;
                        var resultDesc = body.ResultDesc;
                        console.log("Query Body", body);
                    }

                    next();
                }
            }
        );
    }
);




router.post("/subscription/initiate", async (req, res) => {
    const { estate_id } = req.body;

    const householdCountQuery = "SELECT COUNT(*) AS count FROM households WHERE estate_id = ?";
    db.query(householdCountQuery, [estate_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        const total_households = results[0].count;
        const billing_rate = getSubscriptionRate(total_households);

        // Trigger STK push here or return this info to frontend
        res.json({
            estate_id,
            total_households,
            billing_rate,
            message: `Subscription for Ksh ${billing_rate} initiated.`
        });
    });
});



module.exports = router;
