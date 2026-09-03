# Data sources aur kharcha — poori tafseel

> Ye file un logon ke liye hai jinhone spec nahi parhi. Har cheez ye batati hai: **kahan se
> aata hai, muft hai ya paid, aur kitne ka.**
>
> Har qeemat vendor ki apni pricing page se li gayi hai (August 2026). Khareedne se pehle
> vendor ki site pe dobara confirm kar lein — rates badalte rehte hain.

---

## Aap ke paanch stages ka matlab

Aap ne paanch cheezein likhi thi. Har ek ka matlab, aur system mein kaun sa hissa wo kaam karta
hai:

### 1. Data Scraping — bahar se kachcha data lana

Kisi source se raw information uthana. **Koi soch samajh nahi, sirf lana.**

Misaal: Google Maps se "Miami mein screen printing" search kar ke 60 businesses ke naam, phone,
website utha lena.

### 2. Data Analyzing — jo laya hai usko parh kar jawab nikalna

Jo pehle se hai usi ko parh kar decide karna. **Kuch naya nahi laana.**

Misaal: website ka HTML mil gaya → usme `<meta name="viewport">` tag hai ya nahi → nahi hai to
**W5 fire** ("mobile pe theek nahi dikhti").

### 3. Data Enrichment — jo missing hai wo bahar se laa kar bharna

Record adhoora hai, kisi **aur source** se kami poori karna.

**Analyzing se farq:** Analyzing mein jo data pehle se hai usi se jawab nikalta hai. Enrichment
mein **nayi cheez laate hain**.

Misaal: Maps ne business ka number diya lekin **owner ka naam nahi**. Wo kahin aur se laana =
Enrichment.

### 4. Enrichment / Scoring — sab mila kar faisla karna

Saare findings ko jorh kar **ek faisla** banana:

```
6 areas ka score  →  Problem score (0-100)   kitna kharab hai
                  →  Intent score  (0-100)   paisa kharch karte hain?
                  →  Tier 1/2/3/4            kitni priority
                  →  Kya bechna hai
                  →  Opening line            kya kehna hai
```

### 5. Data Export / Usage — kaam mein laana

Dashboard, filters, CSV download, call ka outcome log karna.

---

## Ab tak kitna kharch hua — asli, andaaza nahi

Ye numbers `provider_calls` table se seedhe nikale gaye hain. Wo table **har paid call se pehle**
likhta hai, is liye isme jhoot nahi ho sakta.

| Kya | Calls | Kharcha |
|---|---:|---:|
| Places Text Search (businesses dhoondna) | 34 | $1.36 |
| Places Text Search (location ka centre) | 3 | $0.09 |
| Places Details (rating, reviews, hours) | 77 | $3.08 |
| PageSpeed (speed test) | 209 | **$0.00** |
| Apna crawler (website parhna) | 209+ | **$0.00** |
| **KUL** | | **$4.53** |

Free tier ke andar hone ki wajah se Google ne abhi tak kuch charge nahi kiya. Ye wo raqam hai jo
free tier khatam hone pe lagti.

---

## Har source ka rate

### Jo abhi chal rahe hain

| Source | Rate | Kya deta hai |
|---|---|---|
| **Apna crawler** | **muft** | Website ka HTML, email, phone, owner ka naam |
| **PageSpeed Insights** | **muft** | Mobile speed, W6 aur W7 |
| Places Text Search | $0.035/request | Businesses dhoondna |
| Places Details | $0.035/business | Rating, review count, hours, category |

**Muft wale sab se zyada kaam ke hain** — 51 mein se 46 checks unhi se chalte hain.

### Jo lag sakte hain

| Source | Rate | 209 ka | 2,800 ka |
|---|---|---:|---:|
| DataForSEO (traffic estimate) | $0.12/task + $0.0012/domain | **$0.33** | **$3.48** |
| **Lusha** (owner ka mobile) | $69.90/mah, 480 credits, phone = 5 credits → **$0.73** | **$152** | **$2,044** |
| **RocketReach** (owner ka mobile) | $80/mah, 125 lookups → **$0.64** | **$134** | **$1,792** |
| Apollo (owner ka mobile) | $49/user/mah, mobile = 8 credits | sirf 75/mah — is scale pe na-mumkin | — |

### Jo aukat se bahar hain

| Source | Minimum | Faisla |
|---|---|---|
| Similarweb API | **$500/mah** | chhod dein |
| Semrush API | **$549/mah** plan, phir units alag | chhod dein |
| OpenCorporates | **£2,250/saal** | chhod dein |

---

## Muft trials — khareedne se pehle test

| Kya | Kitna muft | Kis kaam ka |
|---|---|---|
| **Lusha Free** | 40 credits/mah = **8 phone numbers** | coverage test |
| **Apollo trial** | 5 mobile credits | coverage test |
| **DataForSEO** | $1 credit, **card nahi chahiye** | poore 209 ka traffic ($0.33) |

**Coverage test kyun zaroori hai:** Apollo aur Lusha corporate professionals ka database hain.
Mesquite ki braiding salon ya Doral ka plumber unme milega ya nahi — ye kisi ko pata nahi. Agar
8 mein se sirf 2 nikle to $70/mah dena bekaar hai.

---

## Kharcha kaise control hota hai

**Har paid cheez ab select kar ke khareedi jaati hai.** Leads list pe businesses tick karein →
confirm screen qeemat dikhati hai → tab jaa kar kharch hota hai.

Teen cheezein har baar hoti hain:

1. **Jo pehle se khareeda hua hai uska dobara paisa nahi lagta.** Har paid call se pehle
   `provider_calls` check hota hai.
2. **Spend cap** — default $5. Run us se aage nahi barhta, aur jo pehle nikal chuka wo mehfooz.
3. **Har call ledger mein** — kis business ka, kis cheez ka, kitne ka.

**§9 ka gate ab sirf mashwara hai.** Wo batata hai "ye 82 call karne layak lagte hain" — lekin
**khareedne ka faisla aap ka hai**, uska nahi.

---

## Jo kisi qeemat pe nahi mil sakta

Ye chhupaya nahi gaya — har record pe wajah likhi hai, aur score ke dono taraf se bahar hai.

| Kya | Kyun nahi | Kaise pata chala |
|---|---|---|
| **Instagram followers ki list** | Official API sirf `followers_count` deti hai, aur wo bhi sirf un accounts ka jo aap ke apne hon | Meta ki apni docs |
| **"Kis famous banday ko follow karte hain"** | Koi API ye deti hi nahi — kisi qeemat pe nahi | — |
| **LinkedIn profiles bulk mein** | Sab se bare provider Proxycurl ko LinkedIn/Microsoft ne sue kiya, **4 July 2025 ko band** | LinkedIn v. Nubela |
| **Google listing "claimed" hai ya nahi** (S2, N7) | Places API mein ye field hai hi nahi — sirf Maps ke UI mein dikhta hai | live test |
| **Listing ki photos** (S4) | HTTP 200 aata hai magar **body khaali** | 3 apne business + Starbucks (2,243 ratings) pe test |
| **Reviews ki tareekhein, owner ke jawab** (R3, R4, R5, N3, N4) | Wahi — `reviews` field khaali aati hai | wahi test |

**Starbucks wala test kyun:** pehle laga ke shayad in businesses ke paas photos hain hi nahi.
Phir 2,243 ratings wale Starbucks pe chalaya — wahan bhi khaali. To masla businesses ka nahi,
key/project ka hai.

---

## Owner ka personal mobile — qanooni masla

**Ye sirf paisa nahi, risk bhi hai.**

US mein TCPA har mobile number ko **"residential"** maanta hai — chahe wo business owner ka ho.
B2B exemption **sirf business landline** pe lagti hai.

- Har ghalat call: **$500–$1,500**
- 2026 mein class-action cases **23% barh gaye**
- Aap ki apni spec §14 item 6 kehti hai: *"US calling and messaging compliance review — before
  outreach scales"*

**Business landline pe call karna theek hai. Personal cell alag cheez hai.**

Is liye system mein mobile lookup ki **jagah** to bani hui hai (confirm screen pe dikhti hai,
qeemat ke saath) lekin **adapter nahi banaya** — pehle coverage test, phir compliance, phir kharcha.

---

## Muft contact data jo pehle se nikal raha hai

Crawler har business ki website parhta hai aur ye nikaal leta hai — **bilkul muft**:

| Kya | Kitne mile (209 mein se) | Kahan se |
|---|---:|---|
| Email | **66** | Website ke contact/about page se |
| Phone (website wala) | **53** | `tel:` links se |
| Owner ka naam | **3** | Sirf tab jab saaf likha ho |

Owner ka naam sirf 3 nikla — aur **yehi sahi hai**. Zyadatar chhoti websites likhti hi nahi ke
maalik kaun hai. Jo teen mile:

```
Rudy Mage         Inked Pro         (about page)
Merryday Obaseki  Braiders Club     (about page)
Zoey              JEELOOK USA       ("founded by Zoey")
```

Ek chautha naam bhi nikla tha — **"Happy Customer Neet"** — jo asal mein ek customer review se aaya
tha: *"I love the new management/owner - Happy Customer Neet"*. Wo bug theek kiya, record delete
kiya, aur dono jumle (ghalat wala aur asli wala) ab test mein hain taake dobara na ho.

**Owner ka naam sirf tab jab saaf likha ho.** "About Us" page pe koi bhi capital letter wala naam
utha lena andaaza hoga — aur ghalat naam se call shuru karna koi naam na hone se zyada bura hai.

---

## Aik zaroori baat — local network ka masla

Ek audit run mein **209 mein se 112 businesses ko `dns_temporary`** mila. Ye un websites ka masla
nahi tha — ye **is machine ka DNS resolver** tha, 8 concurrent crawls ke neeche baith gaya.

System ne un mein se kisi ko bhi **dead nahi kaha**. Har ek pe likha: *"temporary
name-resolution failure on our side, which says nothing about the site"*.

Agar ye guard na hota to 112 zinda businesses "website dead hai" ke saath list mein aa jaate — aur
koi unhein phone kar ke nayi website bechne ki koshish karta.

**Hal:** `node apps/jobs/run-audit.mjs --outcome dns_temporary --concurrency 3`
