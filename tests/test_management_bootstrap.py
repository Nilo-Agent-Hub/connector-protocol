import dataclasses
import io
import json
import unittest
from unittest import mock

from test_sdk import Bootstrap, Client, ProtocolError, bootstrap


class ManagementBootstrapTests(unittest.TestCase):
    def value(self):
        boot = bootstrap('/private/state')
        return dict(protocol='nilo-connector-bootstrap', version=1, hubUrl=boot.hub_url,
                    token=boot.token, instanceId=boot.instance_id, agentId=boot.agent_id,
                    connectorId=boot.connector_id, stateDir=str(boot.state_dir),
                    manifest=dict(boot.manifest, capabilities=['channel.receive', 'channel.send', 'runtime.manage']),
                    managementToken='independent-management')

    def test_management_is_independent_required_and_private(self):
        value = self.value()
        parsed = Bootstrap.read(io.StringIO(json.dumps(value)))
        self.assertEqual(parsed.management_token, value['managementToken'])
        self.assertNotIn(value['managementToken'], repr(parsed))
        for token in (None, '', value['token'], 'has whitespace'):
            with self.subTest(token=token), self.assertRaises(ProtocolError):
                Bootstrap.read(io.StringIO(json.dumps(dict(value, managementToken=token))))
        value['manifest']['capabilities'].remove('runtime.manage')
        with self.assertRaises(ProtocolError):
            Bootstrap.read(io.StringIO(json.dumps(value)))

    def test_header_is_scoped_to_management_handlers(self):
        client = Client(Bootstrap.read(io.StringIO(json.dumps(self.value()))), attempts=1)
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{}'
        client.opener.open = mock.Mock(return_value=response)
        for path in ('handshake', 'runtime/report', 'coding/connect', 'native/catalog', 'profile', 'inbox'):
            client.request('POST', '/api/connector/' + path, {})
            request = client.opener.open.call_args.args[0]
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertEqual('x-agent-inbox-management-token' in headers, path not in ('profile', 'inbox'))
        client.bootstrap = dataclasses.replace(client.bootstrap, management_token=None)
        with self.assertRaises(ProtocolError):
            client.request('POST', '/api/connector/runtime/report', {})
