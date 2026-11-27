import unittest
from crawler import detect_aliases, validate


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



class AliasDetection(unittest.TestCase):
    def test_evidence_requires_location_repeatability_and_no_disagreement(self):
        locations = dict(city="Bengaluru", lat=12.9, lng=77.6)
        stores = {"S01": locations, "S02": locations, "S03": locations | {"lat": 12.8}}
        pages = {("2026-11-14", str(i)): [{"product_id": str(i)}] for i in range(12)}
        signatures = {"S01": pages, "S02": pages.copy(), "S03": pages}
        self.assertEqual(detect_aliases(stores, signatures),
                         {"S02": {"canonical": "S01", "matched_nonempty": 12}})
        signatures["S02"]["2026-11-14", "0"] = []
        self.assertEqual(detect_aliases(stores, signatures), {})
