// Load Sequelize and Models
const Role = require('./Role');
const User = require('./User');
const Estate = require('./Estate');
const Official = require('./Official');
const Household = require('./Household');
const HouseholdMember = require('./HouseholdMember');
const ServiceCharge = require('./ServiceCharge');
const Payment = require('./Payment');
const Visitor = require('./Visitor');
const Incident = require('./Incident');
const Report = require('./Report');
const Notification = require('./Notification');

// User and Role Association
Role.hasMany(User, { foreignKey: 'role_id' });
User.belongsTo(Role, { foreignKey: 'role_id' });

// Estate and Official Association
Estate.hasMany(Official, { foreignKey: 'estate_id' });
Official.belongsTo(Estate, { foreignKey: 'estate_id' });

// Estate and Household Association
Estate.hasMany(Household, { foreignKey: 'estate_id' });
Household.belongsTo(Estate, { foreignKey: 'estate_id' });

// Household and Member Association
Household.hasMany(HouseholdMember, { foreignKey: 'household_id' });
HouseholdMember.belongsTo(Household, { foreignKey: 'household_id' });

// Service Charge and Payment Association
ServiceCharge.hasMany(Payment, { foreignKey: 'charge_id' });
Payment.belongsTo(ServiceCharge, { foreignKey: 'charge_id' });

// Household and Payment Association
Household.hasMany(Payment, { foreignKey: 'household_id' });
Payment.belongsTo(Household, { foreignKey: 'household_id' });

// Visitor and Household Association
Household.hasMany(Visitor, { foreignKey: 'household_id' });
Visitor.belongsTo(Household, { foreignKey: 'household_id' });

// Visitor and Official (Approved By) Association
Official.hasMany(Visitor, { foreignKey: 'approved_by' });
Visitor.belongsTo(Official, { foreignKey: 'approved_by' });

// Incident and Estate Association
Estate.hasMany(Incident, { foreignKey: 'estate_id' });
Incident.belongsTo(Estate, { foreignKey: 'estate_id' });

// Incident and Official Association (Reported By)
Official.hasMany(Incident, { foreignKey: 'reported_by' });
Incident.belongsTo(Official, { foreignKey: 'reported_by' });

// Official and Report Association
Official.hasMany(Report, { foreignKey: 'generated_by' });
Report.belongsTo(Official, { foreignKey: 'generated_by' });

// User and Notification Association
User.hasMany(Notification, { foreignKey: 'recipient_id' });
Notification.belongsTo(User, { foreignKey: 'recipient_id' });

console.log("✅ All associations have been defined successfully!");

module.exports = {
    Role,
    User,
    Household,
    HouseholdMember,
    ServiceCharge,
    Payment,
    Visitor,
    Incident,
    Report,
    Notification
};
