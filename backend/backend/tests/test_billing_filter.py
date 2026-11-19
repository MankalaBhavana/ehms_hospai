import os
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils.database import list_invoices


class TestBillingFilter(unittest.TestCase):
    @patch("utils.database.get_connection")
    def test_list_invoices_month_and_year(self, mock_get_conn):
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        # Call with year=2026, month=11
        list_invoices(hospital_id=1, year=2026, month=11)

        self.assertTrue(mock_cursor.execute.called)
        sql, params = mock_cursor.execute.call_args[0]

        # Verify SQL contains range checks
        self.assertIn("created_at >= ?", sql)
        self.assertIn("created_at < ?", sql)
        self.assertIn("2026-11-01 00:00:00", params)
        self.assertIn("2026-12-01 00:00:00", params)

    @patch("utils.database.get_connection")
    def test_list_invoices_date_range_time_to_time(self, mock_get_conn):
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        # Call with time to time range
        list_invoices(
            hospital_id=1,
            from_date="2026-11-01 08:00:00",
            to_date="2026-11-19 18:00:00",
        )

        self.assertTrue(mock_cursor.execute.called)
        sql, params = mock_cursor.execute.call_args[0]

        self.assertIn("created_at >= ?", sql)
        self.assertIn("created_at <= ?", sql)
        self.assertIn("2026-11-01 08:00:00", params)
        self.assertIn("2026-11-19 18:00:00", params)

    @patch("utils.database.get_connection")
    def test_list_invoices_single_day_expansion(self, mock_get_conn):
        mock_cursor = MagicMock()
        mock_cursor.fetchall.return_value = []
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_get_conn.return_value.__enter__.return_value = mock_conn

        # Call with date-only string (10 chars)
        list_invoices(
            hospital_id=1,
            from_date="2026-11-19",
            to_date="2026-11-19",
        )

        self.assertTrue(mock_cursor.execute.called)
        sql, params = mock_cursor.execute.call_args[0]

        self.assertIn("2026-11-19 23:59:59", params)


if __name__ == "__main__":
    unittest.main()
