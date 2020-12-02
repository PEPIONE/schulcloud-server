const deleteUserDataUc = require('./deleteUserData.uc');

const facade = {
	deleteUserRelatedData: async (userId) => {
		return deleteUserDataUc.deleteUserData(userId);
	},
};

module.exports = (app) => {
	app.registerFacade('/fileStorage/v2', facade);
};