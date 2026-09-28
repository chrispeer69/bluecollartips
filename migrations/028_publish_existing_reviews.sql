-- Owner decision (Chris Peer, Sep 29 2026): existing ratings are published on the
-- company's own website too, with the customer's first name + last initial and the
-- comment (contact details are stripped by the public feed). Applies to every
-- rating submitted before the public notice went live.

UPDATE ratings SET public_ok = true WHERE public_ok = false;
