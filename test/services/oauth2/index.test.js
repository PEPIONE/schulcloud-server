const assert = require('assert');
const chai = require('chai');
const chaiHttp = require('chai-http');

// proxyserver
const oauth2Server = require('./oauth2MockServer');
const oauth2 = require('../../../src/services/oauth2/index.js');

const app = require('../../../src/app');
const logger = require('../../../src/logger/');

const baseUrlService = app.service('oauth2/baseUrl');
const clientsService = app.service('oauth2/clients');
const loginService = app.service('oauth2/loginRequest');
const introspectService = app.service('oauth2/introspect');
const consentService = app.service('oauth2/auth/sessions/consent');

const testObjects = require('../helpers/testObjects')(app);

chai.use(chaiHttp);

describe('oauth2 service', function oauthTest() {
	this.timeout(10000);

	const testUser2 = {
		_id: '0000d224816abba584714c9c',
	};

	const testClient = {
		client_id: 'unit_test',
		client_name: 'Unit Test Client',
		client_secret: 'xxxxxxxxxxxxx',
		redirect_uris: [
			'https://localhost:8888',
		],
		token_endpoint_auth_method: 'client_secret_basic',
		subject_type: 'pairwise',
	};

	const testClient2 = {
		client_id: 'unit_test_2',
		client_name: 'Unit Test Client',
		client_secret: 'xxxxxxxxxxxxx',
		redirect_uris: [
			'https://localhost:8888',
		],
		token_endpoint_auth_method: 'client_secret_basic',
		subject_type: 'pairwise',
	};

	const testTool1 = {
		_id: '5a79cb15c3874f9aea14daa5',
		name: 'test1',
		url: 'https://tool.com?pseudonym={PSEUDONYM}',
		isLocal: true,
		isTemplate: true,
		resource_link_id: 1,
		lti_version: '1p0',
		lti_message_type: 'basic-start-request',
		secret: '1',
		key: '1',
		oAuthClientId: testClient2.client_id,
	};

	const testTool2 = {
		_id: '5a79cb15c3874f9aea14daa6',
		originTool: '5a79cb15c3874f9aea14daa5',
		name: 'test2',
		url: 'https://tool.com?pseudonym={PSEUDONYM}',
		isLocal: true,
		resource_link_id: 1,
		lti_version: '1p0',
		lti_message_type: 'basic-start-request',
		secret: '1',
		key: '1',
	};

	// let redirectTo = null;
	const hydraUri = app.settings.services.hydra;
	before(async () => {
		this.timeout(10000);

		const o2mock = await oauth2Server({});
		app.settings.services.hydra = o2mock.url;

		app.configure(oauth2);
	});


	after((done) => {
		// sets uri back to original uri
		app.settings.services.hydra = hydraUri;
		done();
	});

	it('is registered', () => {
		assert.ok(clientsService);
		assert.ok(loginService);
		assert.ok(introspectService);
		assert.ok(consentService);
	});

	it('GET BaseUrl', () => baseUrlService.find().then((response) => {
		assert.ok(response);
	}));

	it('CREATE Client', () => app.service('oauth2/clients').create(testClient).then((result) => {
		assert.strictEqual(result.client_id, testClient.client_id);
	}));

	it('FIND Clients', () => app.service('oauth2/clients/').find().then((result) => {
		const foundTestClient = JSON.parse(result)
			.find((client) => (client.client_id === testClient.client_id));
		assert(foundTestClient, foundTestClient.toString());
	}));

	it('DELETE Client', () => app.service('oauth2/clients/').remove(testClient.client_id).then((result) => {
		assert(true);
	}));

	it('GET Login Request', () => app.service('oauth2/loginRequest').get(null).then((result) => {
		assert.strictEqual(result.challenge, null);
	}));

	it('PATCH Login Request Accept', async () => {
		const user = await testObjects.createTestUser();
		const ltiTool = await app.service('ltiTools').create({
			oAuthClientId: 'thethingwearelookingfor',
			url: 'someUrl',
			key: 'someKey',
			secret: 'someSecret',
		});
		const pseudonym = await app.service('pseudonym').create({
			userId: user._id,
			tooldId: ltiTool._id,
			pseudonym: 'somePseudonym',
		});
		const results = await app.service('oauth2/loginRequest').patch(null, {}, {
			query: { accept: 1 },
			account: { userId: testUser2._id },
		});
		// redirectTo = result.redirect_to;
		assert.ok(results.redirect_to.indexOf(testClient2.client_id) !== -1);
		app.service('pseudonym').remove(pseudonym._id);
		app.service('ltiTools').remove(ltiTool._id);
	});

	it('PATCH Login Request Reject', () => app.service('oauth2/loginRequest').patch(null, {}, {
		query: { accept: 0 },
		account: { userId: '0000d224816abba584714c9c' },
	}).then(() => {
		assert.ok(true);
	}));

	// it('GET and PATCH Consent Request', (done) => {
	// 	return request({
	// 		uri: redirectTo,
	// 		method: 'GET',
	// 		followRedirect: false,
	// 	}).then(response => {
	// 		console.log(response);
	// 		assert.ok(true);
	// 		done();
	// 	}).catch(err => {
	// 		console.log(err);
	// 	});
	// });

	it('Introspect Inactive Token', () => app.service('oauth2/introspect').create({ token: 'xxx' }).then((res) => {
		assert((res.active === false));
	}));

	it('GET Consent', () => app.service('oauth2/auth/sessions/consent').get(testUser2._id, {
		account: { userId: testUser2._id },
	}).then((consents) => {
		assert.ok(consents);
	}));

	it('REMOVE Consent', () => app.service('oauth2/auth/sessions/consent').remove(testUser2._id, {
		account: { userId: testUser2._id },
		query: { client: testClient.client_id },
	}).then(() => {
		throw new Error('Was not supposed to succeed');
	}).catch((err) => {
		assert.strictEqual(404, err.statusCode);
	}));
});
