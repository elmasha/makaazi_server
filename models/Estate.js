const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Estate = sequelize.define('Estate', {
    estate_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    estate_name: { type: DataTypes.STRING, allowNull: false },
    location: { type: DataTypes.STRING },
    logo_url: { type: DataTypes.STRING }
}, { tableName: 'estates' });

module.exports = Estate;
