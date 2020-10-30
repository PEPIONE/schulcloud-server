const accountModel = require('../../../services/account/model');

const getUserAccount = async (userId, app) => {
	const account = await accountModel.findOne({ userId });
	return account;
};

const deleteUserAccount = async (userId, app) => {
	const result = await accountModel.deleteOne({ userId });
	return result;
};

const replaceUserAccountWithTombstone = async (userId, app) => {
	const modelService = app.service('accountModel');
	const accounts = await modelService.find({ query: { userId } });
	const account = accounts && accounts.length === 1 ? accounts[0] : undefined;
	if (account) {
		const { _id, username } = account;
		const deletedUsername = username && username.indexOf('DELETED_') < 0 ? `DELETED_${username}` : username;
		return modelService.patch(_id, {
			username: deletedUsername,
			deletedAt: new Date(),
		});
	}
	return Promise.resolve(true);
};

module.exports = {
	getUserAccount,
	deleteUserAccount,
	replaceUserAccountWithTombstone,
};
