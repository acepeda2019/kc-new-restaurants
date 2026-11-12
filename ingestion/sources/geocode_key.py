r"""Canonical geocode cache key. dbt (``int_addresses_normalized`` / ``int_address_geocodes``)
MUST reproduce this rule exactly, or KC addresses will not join to their geocodes.

Rule version: ``v1`` (recorded in every geocoder manifest as ``key_rule_version``).

Inputs are the KC ``address`` and ``zip_code`` fields as received (null counts as empty).

street_clean:
  1. upper-case;
  2. keep only the text before the first comma (KC puts the unit after a comma:
     ``17620 140TH AVE SE, C-7``);
  3. replace each run of ASCII whitespace (space, tab, CR, LF, FF, VT) with one space;
     trim leading/trailing spaces;
  4. remove one trailing unit designator with its value, i.e. the regex
     `` (#|STE\.) ?[^ ]+$| (STE|SUITE|UNIT|SPACE|BLDG) [^ ]+$`` (``#120``, ``# 120``,
     ``STE. 5``, ``STE 105``, ``SUITE A``, ``UNIT 1``, ``SPACE 12``, ``BLDG C``);
     word designators need a following space, so ``100 STEWART`` is left alone (known
     limitation: ``100 UNIT RD`` becomes ``100``; no such KC address existed on 2026-11-12);
  5. trim spaces again.
  Street suffixes are NOT rewritten (``BL`` stays ``BL``); the geocoder repairs those.

zip5: trim spaces, then the first 5 characters (``98109-4610`` -> ``98109``).

geocode_key: lower-case hex MD5 (32 chars) of the UTF-8 string ``street_clean || '|' || zip5``.
City is not part of the key (117 raw spellings for 69 cities; the geocoder barely uses it).

On the 10,772 distinct KC (address, city, zip, classification) rows of 2026-11-12 this rule
gives the same street_clean as the profiling rule in ``exploration/census_geocoder/06_*``.

Snowflake translation (written for dbt; NOT yet run in Snowflake, so dbt must add a test that
compares it with the keys in the geocoder request files)::

    trim(regexp_replace(
        trim(regexp_replace(split_part(upper(address), ',', 1), '\\s+', ' ')),
        ' (#|STE\\.) ?[^ ]+$| (STE|SUITE|UNIT|SPACE|BLDG) [^ ]+$', ''))      as street_clean,
    left(trim(zip_code), 5)                                                 as zip5,
    md5(street_clean || '|' || zip5)                                        as geocode_key

(Snowflake ``split_part`` on a string without a comma returns the whole string, and ``\s`` is
ASCII whitespace, matching steps 2 and 3. ``coalesce`` nulls to '' first.)

Addresses whose street_clean is empty (e.g. KC ``", 1"``) get no key and are not geocoded.
"""

from __future__ import annotations

import hashlib
import re

KEY_RULE_VERSION = "v1"

_WHITESPACE = re.compile(r"[ \t\n\r\f\v]+")
_TRAILING_UNIT = re.compile(r" (#|STE\.) ?[^ ]+$| (STE|SUITE|UNIT|SPACE|BLDG) [^ ]+$")


def normalize_street(address: str | None) -> str:
    """street_clean per the canonical rule above."""
    if not address:
        return ""
    street = address.upper().split(",", 1)[0]
    street = _WHITESPACE.sub(" ", street).strip(" ")
    return _TRAILING_UNIT.sub("", street).strip(" ")


def normalize_zip5(zip_code: str | None) -> str:
    """zip5 per the canonical rule above."""
    if not zip_code:
        return ""
    return zip_code.strip(" ")[:5]


def normalize_city(city: str | None) -> str:
    """City as sent to the geocoder (not part of the key): upper-case, whitespace collapsed."""
    if not city:
        return ""
    return _WHITESPACE.sub(" ", city.upper()).strip(" ")


def key_from_parts(street_clean: str, zip5: str) -> str:
    return hashlib.md5(f"{street_clean}|{zip5}".encode(), usedforsecurity=False).hexdigest()


def geocode_key(address: str | None, zip_code: str | None) -> str | None:
    """The cache key for a KC address, or None when the street normalizes to empty."""
    street = normalize_street(address)
    if not street:
        return None
    return key_from_parts(street, normalize_zip5(zip_code))
