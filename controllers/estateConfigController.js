const db = require('../config/db');

exports.getAddressConfig = (req,res) =>{
    const {estate_id} = req.params;
    const sql = `SELECT * FROM estate_address_config WHERE estate_id = ?`;


    db.query(sql, [estate_id], (err,results)=>{
        if(err) return res.status(500).json({error :err.message});
        if (results.length === 0){
            return res.status(200).json({
                street:true,
                section:true,
                court:true,
            })
        }
        return res.json(results[0])
    })

};


// Get address config for an estate (used by UI)
exports.getEstateAddressConfig = (req, res) => {
    const { estate_id } = req.params;

    const sql = `
        SELECT show_street, show_section, show_court
        FROM estate_address_config
        WHERE estate_id = ?
    `;

    db.query(sql, [estate_id], (err, results) => {
        if (err) {
            console.error("❌ Error fetching estate config:", err);
            return res.status(500).json({ error: "Database error" });
        }

        if (!results.length) {
            // default config if not set
            return res.json({
                show_street: true,
                show_section: true,
                show_court: true
            });
        }

        res.json(results[0]);
    });
};






// Create Estate
exports.createEstateAddress = (req, res) => {
    const  { estate_id,show_street, show_section,show_court } = req.body;
      
    const sql = 'INSERT INTO estate_address_config (estate_id,show_street, show_section,show_court) VALUES (?,?,?,?)';

    db.query(sql, [
        estate_id,show_street, show_section,show_court
    ], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Estate Config created successfully', estateId: result.insertId });
    });
};




// Create or update estate config (ADMIN)
exports.saveEstateAddressConfig = (req, res) => {
    const { estate_id, show_street, show_section, show_court } = req.body;

    const sql = `
        INSERT INTO estate_address_config 
            (estate_id, show_street, show_section, show_court)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            show_street = VALUES(show_street),
            show_section = VALUES(show_section),
            show_court = VALUES(show_court),
            updated_at = CURRENT_TIMESTAMP
    `;

    db.query(
        sql,
        [estate_id, show_street, show_section, show_court],
        (err) => {
            if (err) {
                console.error("❌ Error saving estate config:", err);
                return res.status(500).json({ error: "Failed to save config" });
            }

            res.json({ message: "Estate address configuration saved" });
        }
    );
};



/**
 * ============================
 * DROPDOWN VALUES (ADMIN)
 * ============================
 */

// Add section
exports.addSection = (req, res) => {
    const { estate_id, section_name } = req.body;

    const sql = `
        INSERT INTO estate_sections (estate_id, section_name)
        VALUES (?, ?)
    `;

    db.query(sql, [estate_id, section_name], (err) => {
        if (err) {
            console.error("❌ Error adding section:", err);
            return res.status(500).json({ error: "Failed to add section" });
        }

        res.json({ message: "Section added successfully" });
    });
};

// Add court
exports.addCourt = (req, res) => {
    const { estate_id, court_name } = req.body;

    const sql = `
        INSERT INTO estate_courts (estate_id, court_name)
        VALUES (?, ?)
    `;

    db.query(sql, [estate_id, court_name], (err) => {
        if (err) {
            console.error("❌ Error adding court:", err);
            return res.status(500).json({ error: "Failed to add court" });
        }

        res.json({ message: "Court added successfully" });
    });
};

// Add street
exports.addStreet = (req, res) => {
    const { estate_id, street_name } = req.body;

    const sql = `
        INSERT INTO estate_streets (estate_id, street_name)
        VALUES (?, ?)
    `;

    db.query(sql, [estate_id, street_name], (err) => {
        if (err) {
            console.error("❌ Error adding street:", err);
            return res.status(500).json({ error: "Failed to add street" });
        }

        res.json({ message: "Street added successfully" });
    });
};


/**
 * ============================
 * DROPDOWN VALUES (REGISTRATION)
 * ============================
 */

// Get dropdown data for registration
exports.getAddressDropdowns = (req, res) => {
    const { estate_id } = req.params;

    const queries = {
        sections: `SELECT section_name FROM estate_sections WHERE estate_id = ? AND active = 1`,
        courts: `SELECT court_name FROM estate_courts WHERE estate_id = ? AND active = 1`,
        streets: `SELECT street_name FROM estate_streets WHERE estate_id = ? AND active = 1`
    };

    const result = {};

    db.query(queries.sections, [estate_id], (err, sections) => {
        if (err) return res.status(500).json({ error: "Failed to load sections" });
        result.sections = sections.map(s => s.section_name);

        db.query(queries.courts, [estate_id], (err, courts) => {
            if (err) return res.status(500).json({ error: "Failed to load courts" });
            result.courts = courts.map(c => c.court_name);

            db.query(queries.streets, [estate_id], (err, streets) => {
                if (err) return res.status(500).json({ error: "Failed to load streets" });
                result.streets = streets.map(s => s.street_name);

                res.json(result);
            });
        });
    });
};
