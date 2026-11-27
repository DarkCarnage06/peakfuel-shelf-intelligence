import unittest
from crawler import validate


class PageValidation(unittest.TestCase):
    def setUp(self):
        self.day = "2026-11-14"
        self.page = dict(day=self.day, store_id="S01", keyword="oats", page=1,
                         results=[], total=0, has_next=False)

    def validate(self, **overrides):
        return validate(self.page | overrides, self.day, "S01", "oats", 1, None)

    def test_verified_empty(self):
        self.assertEqual(self.validate()["total"], 0)

    def test_silent_empty_rejected(self):
        with self.assertRaisesRegex(ValueError, "total"):
            self.validate(total=None)

    def test_wrong_store_rejected(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            self.validate(store_id="S02")

    def test_incomplete_page_rejected(self):
        with self.assertRaisesRegex(ValueError, "positions"):
            self.validate(total=2)

    def test_contradictory_pagination_rejected(self):
        with self.assertRaisesRegex(ValueError, "pagination"):
            self.validate(has_next=True)

