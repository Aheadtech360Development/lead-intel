import { describe, expect, it } from "vitest";
import { extractContacts } from "./contacts.js";
import { parsePage } from "./parse.js";
import type { SitePage } from "./types.js";

function pages(...html: Array<[SitePage["role"], string]>) {
  return html.map(([role, body]) =>
    parsePage({ url: `https://example.com/${role === "homepage" ? "" : role}`, role, html: body }),
  );
}

describe("extractContacts — emails", () => {
  it("finds the address the site publishes", () => {
    const contacts = extractContacts(
      pages(["homepage", '<html><body><a href="mailto:hello@example.com">Email us</a></body></html>']),
      "example.com",
    );
    expect(contacts.email).toBe("hello@example.com");
  });

  /** A named mailbox reaches a person; a shared one reaches a queue. */
  it("prefers a person's mailbox over a shared inbox", () => {
    const contacts = extractContacts(
      pages([
        "homepage",
        `<html><body>
          <a href="mailto:info@fibercircleyarn.com">General</a>
          <a href="mailto:diane@fibercircleyarn.com">Diane</a>
        </body></html>`,
      ]),
      "fibercircleyarn.com",
    );
    expect(contacts.email).toBe("diane@fibercircleyarn.com");
    expect(contacts.allEmails).toHaveLength(2);
  });

  it("prefers an address on the business's own domain over a stray one", () => {
    const contacts = extractContacts(
      pages([
        "homepage",
        `<html><body>
          <a href="mailto:someguy@gmail.com">a</a>
          <a href="mailto:orders@acmeprint.com">b</a>
        </body></html>`,
      ]),
      "acmeprint.com",
    );
    expect(contacts.email).toBe("orders@acmeprint.com");
  });

  /**
   * Taken from the live data: `help.us@booksy.com` was stored against a braiding salon in
   * Mesquite. It is a real address — Booksy's support desk — and mailing it reaches a booking
   * platform, not the salon.
   */
  it("rejects a booking platform's own support address", () => {
    const contacts = extractContacts(
      pages(["homepage", '<html><body><a href="mailto:help.us@booksy.com">Help</a></body></html>']),
      "houseofkerlbraiding.booksy.com",
    );
    expect(contacts.email).toBeNull();
    expect(contacts.allEmails).toEqual([]);
  });

  it("ignores no-reply boxes for the headline address but still records them", () => {
    const contacts = extractContacts(
      pages(["homepage", '<html><body><a href="mailto:noreply@acme.com">x</a></body></html>']),
      "acme.com",
    );
    expect(contacts.email).toBeNull();
    expect(contacts.allEmails).toEqual(["noreply@acme.com"]);
  });

  it("does not read an image filename as an address", () => {
    const contacts = extractContacts(
      pages(["homepage", "<html><body><p>logo@2x.png and hero@3x.jpg</p></body></html>"]),
      "acme.com",
    );
    expect(contacts.allEmails).toEqual([]);
  });

  it("looks across every page it read, not just the homepage", () => {
    const contacts = extractContacts(
      pages(
        ["homepage", "<html><body><p>Welcome</p></body></html>"],
        ["contact", '<html><body><a href="mailto:shop@acme.com">Email</a></body></html>'],
      ),
      "acme.com",
    );
    expect(contacts.email).toBe("shop@acme.com");
  });
});

describe("extractContacts — the owner's name", () => {
  /** The one relationship schema.org gives that means exactly "this person started this". */
  it("takes a founder from the site's own structured data", () => {
    const contacts = extractContacts(
      pages([
        "homepage",
        `<html><head><script type="application/ld+json">
          {"@type":"LocalBusiness","name":"Fiber Circle","founder":{"@type":"Person","name":"Diane Michaels"}}
        </script></head><body>x</body></html>`,
      ]),
      "fibercircleyarn.com",
    );
    expect(contacts.ownerName).toBe("Diane Michaels");
    expect(contacts.ownerNameSource).toMatch(/structured data/i);
  });

  it.each([
    ["<p>Owner: Diane Michaels</p>", "Diane Michaels"],
    ["<p>Founder — Sarah Kelly</p>", "Sarah Kelly"],
    ["<p>Founded by Marcus Webb in 1998.</p>", "Marcus Webb"],
    ["<p>Proprietor: Ana Ruiz</p>", "Ana Ruiz"],
  ])("reads a plainly labelled name from %s", (body, expected) => {
    const contacts = extractContacts(pages(["about", `<html><body>${body}</body></html>`]), "acme.com");
    expect(contacts.ownerName).toBe(expected);
  });

  /**
   * The expensive direction. A guessed owner name is worse than none — the operator opens the
   * call with it and is immediately wrong about who they are speaking to.
   */
  it.each([
    "<html><body><h1>About Us</h1><p>We are a family business serving Miami since 1998.</p></body></html>",
    '<html><body><p>"Great service!" — Jennifer Adams, customer</p></body></html>',
    "<html><body><p>Posted by Mike Torres on our blog</p></body></html>",
    "<html><body><h2>Meet The Team</h2><p>Our staff are the best.</p></body></html>",
  ])("does not invent a name from %s", (html) => {
    expect(extractContacts(pages(["about", html]), "acme.com").ownerName).toBeNull();
  });

  it("rejects a label followed by something that is not a name", () => {
    const contacts = extractContacts(
      pages(["about", "<html><body><p>Owner: The Company</p></body></html>"]),
      "acme.com",
    );
    expect(contacts.ownerName).toBeNull();
  });

  it("says where the name came from, so it can be judged", () => {
    const contacts = extractContacts(
      pages(["about", "<html><body><p>Owner: Diane Michaels</p></body></html>"]),
      "acme.com",
    );
    expect(contacts.ownerNameSource).toContain("about");
  });
});

describe("extractContacts — nothing found", () => {
  it("returns nulls rather than empty strings", () => {
    const contacts = extractContacts(pages(["homepage", "<html><body><p>Nothing here.</p></body></html>"]), "acme.com");
    expect(contacts.email).toBeNull();
    expect(contacts.phone).toBeNull();
    expect(contacts.ownerName).toBeNull();
    expect(contacts.ownerNameSource).toBeNull();
    expect(contacts.allEmails).toEqual([]);
  });

  it("handles a site that could not be read at all", () => {
    const contacts = extractContacts([], null);
    expect(contacts.email).toBeNull();
    expect(contacts.ownerName).toBeNull();
  });
});

describe("extractContacts — the false positive live data found", () => {
  /**
   * Verbatim from `maatiibeautysupply.com`. A customer review, read as an owner's name by an
   * earlier version of this code — precisely the failure the module claims not to make. The tell
   * is the character before the label: a real label begins a phrase, so it follows a space or the
   * start of the text, never a slash or the tail of another word.
   */
  it("does not read a customer review as the owner", () => {
    const review =
      "<html><body><p>5 stars for the customer service. I love the new management/owner - " +
      "Happy Customer Neet and lots of options This place was neatly arranged.</p></body></html>";
    expect(extractContacts(pages(["homepage", review]), "maatiibeautysupply.com").ownerName).toBeNull();
  });

  /** The one it should keep, also verbatim, so the fix cannot be a blanket refusal. */
  it("still reads a genuine 'founded by' line", () => {
    const real =
      "<html><body><p>Who we are. Jeelook is a handcrafted candle brand founded by Zoey, " +
      "created for those who appreciate beauty and detail.</p></body></html>";
    expect(extractContacts(pages(["homepage", real]), "jeelook.com").ownerName).toBe("Zoey");
  });

  it.each([
    "<p>The management/owner - Sarah is great</p>",
    "<p>Homeowner - Bob left a review</p>",
    "<p>Shopowner - Jane wrote in</p>",
  ])("rejects a label that is part of another word: %s", (body) => {
    expect(extractContacts(pages(["homepage", `<html><body>${body}</body></html>`]), "acme.com").ownerName).toBeNull();
  });

  /** "Co-owner" is a real label meaning exactly what it says, so it is accepted deliberately
   *  rather than by accident of where the hyphen falls. */
  it("accepts co-owner as a label", () => {
    const contacts = extractContacts(
      pages(["about", "<html><body><p>Co-owner: Sarah Kelly</p></body></html>"]),
      "acme.com",
    );
    expect(contacts.ownerName).toBe("Sarah Kelly");
  });
});
