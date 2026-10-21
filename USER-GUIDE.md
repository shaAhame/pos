# Daily guide

## Who can do what
| | Cashier | Manager | Owner |
|---|:-:|:-:|:-:|
| Sell, print receipts, open and close own shift | ✓ | ✓ | ✓ |
| Add and edit customers | ✓ | ✓ | ✓ |
| See own sales | ✓ | ✓ | ✓ |
| See all sales, void sales, return items | | ✓ | ✓ |
| Stock deliveries and stock counts (own branch), suppliers | | ✓ | ✓ |
| Reports, everyone's shifts | | ✓ | ✓ |
| Discount above the cashier limit | | ✓ | ✓ |
| Add products, change prices | | | ✓ |
| Branches, stock transfers between branches | | | ✓ |
| Confirm a transfer arrived at your branch | | ✓ | ✓ |
| Staff logins, employees and salaries, shop settings | | | ✓ |
| Repairs, orders, installment payments, warranty lookup* | ✓ | ✓ | ✓ |
| Supplier claims* | | ✓ | ✓ |

\* Only if MacQuad has switched the feature on for your business.

## Start of the day (cashier)
1. Log in. The till asks you to **open your shift**.
2. Count the cash in the drawer and enter it. That's your opening float.

## Selling
- **Scan** a barcode, or type part of a name and press **Enter**, or tap a product.
- Change quantities with **−** / **+** or type the number.
- **Customer** adds a regular customer (or just a name) to the receipt.
- Enter a **Discount %** if needed. Cashiers are limited to the amount set by the owner.
- Press **Pay** (or **F9**).
  - **Cash:** type the amount received or tap a quick amount. The change to give is shown in large numbers.
  - **Card:** charge the card on the bank machine first, then press **Complete sale**.
- **Print receipt**, then **New sale**. **F2** jumps back to the search box.

## End of the day (cashier)
1. **My shift** → **Close shift**.
2. Count all the cash in the drawer and enter it. The POS shows whether the drawer is exact, short or over, and keeps the record for the manager.

## Mistakes and returns (manager)
- **Void**: for a sale rung up by mistake *during the same shift*. **Sales** → open the sale → **Void sale**. The sale stays in the records, marked VOIDED, and stock goes back.
- **Return**: when a customer brings goods back, or the shift is already closed. **Sales** → open the sale → **Return items**. Choose quantities, untick *Back on shelf* for damaged goods, and choose Cash or Card refund. Cash refunds need you to have an open shift, because the cash comes from your drawer.

## Stock (manager)
- **Delivery arrived:** **Products** → **Stock** → *Received delivery*: units, cost and supplier.
- **Stock count:** **Products** → **Stock** → *Stock count*: enter what's actually on the shelf, with a reason.
- **History** shows every change: sales, returns, voids, deliveries and counts, with who did it.
- **Archive** a product you no longer sell. It leaves the till but its history stays.
- Products at or below their warning level show in **Reports → Running low**.

## Reports (manager)
Pick a period to see net sales, profit (for products with a cost price), cash and card totals, returns, voids, best sellers and low stock.
**Download sales (CSV)** opens in Excel for your accountant.

## If the internet goes down
Keep selling. The top bar shows **Offline**, and sales are saved on that till and uploaded automatically later.
Receipts printed while offline say "Receipt (offline)"; the invoice number is given when it uploads.

## Branches (owner)
- **Branches** page: add each shop, and your main store or warehouse. A warehouse holds stock but has no till.
- Products and prices are shared by every branch. Stock is counted separately in each one.
- Each staff login belongs to one branch, and staff only see their own branch's stock, sales and shifts.
- The **branch menu** at the top switches what you're looking at: one branch, or **All branches** together.
  To sell yourself, pick the shop first, then open a shift.
- **Reports** with *All branches* shows a **Branches compared** table: sales, refunds, net sales and stock value per branch.

## Moving stock between branches
1. **Transfers** → **New transfer** (owner only). Choose **From** and **To**, add products and quantities, then **Send transfer**.
   The stock leaves the sending branch straight away and shows as *On the way*.
2. When the goods arrive, the receiving branch's manager opens the transfer, counts what actually came, changes any
   number that's short, and presses **Confirm received**. Only what arrived is added to their stock; anything missing is recorded.
3. If the goods never leave, the owner can **Cancel transfer** while it's still on the way, and everything goes back.

Every step shows in each product's **History**, with the transfer number.

## Electronics and phone shops
These appear when MacQuad switches them on for your business.

**Serial / IMEI numbers.** Tick *Track serial / IMEI* on a product, and enter one serial per unit whenever stock
comes in (opening stock, deliveries, transfers). At the till, scan the IMEI and that exact unit goes on the sale; tap
the product instead to choose a unit from the list. The receipt shows each serial and its warranty end date.

**Variants.** Fill in *Model* and *Variant* (e.g. "8/256 Navy") on a product. Each variant is its own product with its
own price and stock, and the till shows the full name.

**Warranty lookup.** Type a serial, IMEI, invoice number or phone number to see when and where it was sold and
whether it's still under warranty.

**Payments at the till.** Split one sale across cash, card and bank transfer. Trade-in: the customer's old phone
counts as part payment (optionally put it into stock). Installments: choose a saved customer, take a down payment,
choose the months; the system makes the payment schedule. A cashier's discount above the shop limit needs a manager
to approve with their PIN (managers set their PIN under *Account*).

**Installments.** See every plan, what's owed, and who's late. Open a plan and *Take a payment* when the customer
pays. A plan can't be voided once payments have been taken; use a return instead.

**Repairs.** *Book in a repair* with the customer, device, serial and fault, and print the job slip for the customer.
Move the job through *Checking → Waiting for parts → Repairing → Ready to collect*. Parts used come out of stock.
If the serial was sold here and is still under warranty, the repair is free automatically. *Customer collects*
takes payment and prints a receipt.

**Orders with a deposit.** For something not in stock: take the customer's details and a deposit. *Mark ready* when it
arrives, then *Customer collects*: scan the serials, take the balance, receipt printed. Cancelling gives the deposit
back.

**Supplier claims (manager).** Send faulty units back to the supplier: the unit leaves stock. When the supplier
responds, record whether they repaired it, replaced it (enter the new serial; it goes back on the shelf), gave
credit, or rejected the claim.
