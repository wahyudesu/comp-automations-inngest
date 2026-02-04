```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```


secara project tuh ini hono cloudflare worker yg didalemnya ada cloudflare workflow dan inngest, stepnya tuh ukurang lebih seperti ini

cloudflare workflow yg di trigger via cron
data scrapping yaitu ig scrapping trus upload to r2 dan insert to db, selesai ini nanti dia hit rest api yg nantinya bakal trigger function di inngest
ig scrapping ->
web scrapping -> raplace image with r2 domain -> insert db

note:
- skip lomba kalo udh ada
- cron berjalan 8 jam sekali
- setelah cloudflare workflow ini berjalan maka akan trigger function inngest
- log nya jelas dan simple

inngest function
data extraction -> update db -> sending wa

note:
- function data extrtaction jalannya satu per satu terlebih dahulu yang nantinya 
- cloudflare workflow pertama itu data scrapping yaitu ig scrapping trus upload to r2 dan insert to db, selesai ini nanti dia hit rest api yg nantinya bakal trigger function di inngest
- inggest function jalanin  function data extraction dna update db dan mengirimnya ke db yg berjalan secara paralel 2, 2, gitu sampe dikirim ke wa



## perbaikan variabel lewat prompt
untuk title lomba itu alur mekanisme nya didapat darimana yah

kategori dipertimbangkan lagi

posternya itu apakah ngambil dari R2 database cloudflare? jika iya pertimbangkan step 2 nya 

perlu pertimbangan ini lomba gak dari teks yg didapet, dan lomba itu identik dengan apa aja

kalau udah bisa berjalan cron dengan baik maka langsung bikin channel wa aja

database nya yg dari sosial media ubah jadi instagram, krna info lomba seuma dtengnya dri instagram


schema fix + proses ekstraksi = cron wa channel

1. Scraping Phase (Step 1)                            
                                                        
  Web Scraping (1.web-scrape.ts:97-118):                
  - Title diambil dari elemen HTML                      
  h2.post-title.entry-title a di infolombait.com        
  - Disimpan sebagai title field di ScrapedPost         
                                                        
  Instagram Scraping (1.ig-scrape.ts:62-70):            
  - Title di-set ke null (karena postingan Instagram    
  umumnya tidak punya judul eksplisit)                  
  - Hanya mengambil caption, url, dan display_url       
                                                        
  ---                                                   
  2. Insert ke Database (Step 3)                        
                                                        
  Data dari scraping (dengan title yang mungkin null    
  atau dari web) disimpan ke tabel competitions dengan  
  status 'draft'.  bv 


postgresql://postgres.znmkybliodrrbzynexyl:wahyuikbal7A@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres

postgresql://postgres.znmkybliodrrbzynexyl:wahyuikbal7A@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

postgresql://postgres:wahyuikbal7A@db.znmkybliodrrbzynexyl.supabase.co:5432/postgres

postgresql://postgres.znmkybliodrrbzynexyl:wahyuikbal7A@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres


oiya aku izin gaikut yah sampe seterusnya, udh ada agnes yg handle content tech, ikut klo ada kperluan aja

my responsibility as leader is makesure my vice and asso can grow in techfusion, better than any divission

klo divisi yg lain ada kurang bisa dibantu yah, sama kek gw bantu bantu researcher lain, community, competition