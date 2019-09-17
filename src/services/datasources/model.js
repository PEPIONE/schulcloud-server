const mongoose = require('mongoose');

const { Schema } = mongoose;

const dataSourceSchema = new Schema({
	createdBy: { type: Schema.Types.ObjectId, ref: 'user', required: true },
	updatedBy: { type: Schema.Types.ObjectId, ref: 'user' },
	lastRun: { type: Date },
	lastStatus: { type: String, enum: ['Success', 'Warning', 'Error'] },
	config: { type: Object },
	schoolId: { type: Schema.Types.ObjectId, ref: 'school' },
}, { timestamps: true });

const dataSourceRunSchema = new Schema({
	datasource: { Type: Schema.Types.ObjectId, ref: 'datasource', required: true },
	createdBy: { type: Schema.Types.ObjectId, ref: 'user', required: true },
	duration: { type: Number },
	status: { type: String, enum: ['Success', 'Warning', 'Error'] },
	dryrun: { type: Boolean },
	log: { type: String },
	config: { type: Object },
}, { timestamps: true });

const datasourceModel = mongoose.model('datasource', dataSourceSchema);
const datasourceRunModel = mongoose.model('datasourceRun', dataSourceRunSchema);

module.exports = { datasourceModel, datasourceRunModel };
