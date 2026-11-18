# =============================================================================
# db/seed.py — Seed PostgreSQL with initial departments and users
# =============================================================================
"""
Run this once after init_db() to populate the users and departments tables.
"""
from __future__ import annotations

import logging

from db.models import Department, User
from db.session import db_session, init_db

logger = logging.getLogger(__name__)

_DEPARTMENTS = ["Engineering", "Executive"]

_USERS = [
    # (name, email, role, department_name)
    ("Lakshan (CEO)",   "lakshans.pineappleai@gmail.com",  "executive",       "Executive"),
    ("Senior PM",       "pm.pineappleai@gmail.com",        "department_head", "Engineering"),
    ("Thanfees",        "thanfeest.pineappleai@gmail.com", "employee",        "Engineering"),
    ("Aathipan",        "aathipanm.pineappleai@gmail.com", "employee",        "Engineering"),
    ("Vithushak",       "vithushak.pineappleai@gmail.com", "employee",        "Engineering"),
    ("Muzzamil",        "muzzamilk.pineappleai@gmail.com", "employee",        "Engineering"),
    ("Nayanan",         "nayananv.pineappleai@gmail.com",  "employee",        "Engineering"),
    ("Shahmim",         "shahmimtm.pineappleai@gmail.com", "employee",        "Engineering"),
]


def seed(force: bool = False) -> None:
    """
    Seed departments and users.  Skips if already seeded (unless force=True).
    """
    with db_session() as db:
        # Departments
        existing_depts = db.query(Department).count()
        if existing_depts == 0 or force:
            for name in _DEPARTMENTS:
                if not db.query(Department).filter(Department.name == name).first():
                    db.add(Department(name=name))
            db.flush()
            logger.info("Seeded %d departments", len(_DEPARTMENTS))

        # Users
        existing_users = db.query(User).count()
        if existing_users == 0 or force:
            for name, email, role, dept_name in _USERS:
                if db.query(User).filter(User.email == email).first():
                    continue
                dept = db.query(Department).filter(Department.name == dept_name).first()
                if dept is None:
                    logger.warning("Department '%s' not found — skipping user %s", dept_name, email)
                    continue
                db.add(User(name=name, email=email, role=role, department_id=dept.id))
            logger.info("Seeded %d users", len(_USERS))

    logger.info("✅ Database seeded successfully")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    seed()
