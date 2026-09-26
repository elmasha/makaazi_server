const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Report = sequelize.define('Report', {
    report_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    report_type: { type: DataTypes.STRING },
    generated_by: { type: DataTypes.INTEGER, allowNull: false },
    generated_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'reports' });

module.exports = Report;
