import io
import json
import unittest
from unittest.mock import patch
from serve import plan


class ModelQueryPlan(unittest.TestCase):
    def test_only_allowed_filters_leave_model_boundary(self):
        proposed = dict(intent="visibility", market="Imaginary city", word="protein bar",
                        end=None, window=7, brand=None, percentage=100)
        envelope = {"output": [{"content": [{"type": "output_text", "text": json.dumps(proposed)}]}]}
        with patch("serve.urlopen", return_value=io.BytesIO(json.dumps(envelope).encode())) as provider:
            self.assertEqual(plan("How did we do on protein bar this week?", "test-key"),
                             {"intent": "visibility", "word": "protein bar", "window": 7})
        request = provider.call_args.args[0]
        payload = json.loads(request.data)
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertEqual(payload["input"], "How did we do on protein bar this week?")
