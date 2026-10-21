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
