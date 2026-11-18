import importlib.util
import os
import unittest

MODULE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "ingestion",
    "progress.py",
)
SPEC = importlib.util.spec_from_file_location("insight_hub_ingestion_progress", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
PROGRESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROGRESS)

StageTracker = PROGRESS.StageTracker


class StageTrackerTests(unittest.TestCase):
    def test_attachment_tracker_uses_image_processing_labels_and_file_units(self):
        tracker = StageTracker(job_kind="attachments")

        stages = {stage["key"]: stage for stage in tracker.snapshot()}

        self.assertEqual(stages["read"]["label"], "Reading attachment records")
        self.assertEqual(stages["read"]["unit"], "files")
        self.assertEqual(stages["extract"]["label"], "Running OCR & text extraction")
        self.assertEqual(stages["embed"]["label"], "Creating vector fingerprints")

    def test_attachment_progress_reaches_all_vector_stages(self):
        tracker = StageTracker(job_kind="attachments")

        for stage, count in (
            ("read", 1),
            ("extract", 1),
            ("chunk", 3),
            ("embed", 3),
            ("store", 3),
        ):
            tracker.advance(stage)
            tracker.add(stage, count)
        tracker.finish("Image run complete")

        stages = tracker.snapshot()
        self.assertTrue(all(stage["state"] == "done" for stage in stages))
        self.assertEqual([stage["count"] for stage in stages], [1, 1, 3, 3, 3])
        self.assertEqual(tracker.log_lines()[-1]["message"], "Image run complete")

    def test_mail_tracker_keeps_existing_labels(self):
        tracker = StageTracker()
        stages = {stage["key"]: stage for stage in tracker.snapshot()}

        self.assertEqual(stages["read"]["label"], "Reading mail")
        self.assertEqual(stages["read"]["unit"], "emails")

    def test_combined_tracker_describes_mail_and_attachment_work(self):
        tracker = StageTracker(job_kind="combined")
        stages = {stage["key"]: stage for stage in tracker.snapshot()}

        self.assertEqual(stages["read"]["label"], "Reading new mail & files")
        self.assertEqual(stages["read"]["unit"], "items")
        self.assertEqual(stages["extract"]["label"], "Running OCR & text extraction")

    def test_change_callback_fires_only_for_valid_progress_mutations(self):
        changes = []
        tracker = StageTracker(job_kind="combined", on_change=lambda: changes.append("changed"))

        tracker.advance("read")
        tracker.add("read", 2)
        tracker.log("Read two items")
        tracker.add("unknown", 1)
        tracker.add("read", 0)
        tracker.finish("Done")
        tracker.finish("Already done")

        self.assertEqual(len(changes), 4)


if __name__ == "__main__":
    unittest.main()
