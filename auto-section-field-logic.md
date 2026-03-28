



Section 1: Auto Policy
field: Client Name
field: Client Address
field: Client Phone
field: Quote Date / Print Date
field: Quote Effective Date
field: Quote Expiration Date
field: Quote / Submission / Proposal ID Number
field: Policy Term (6-month, or 12-month (only 2 options dropdown). VERY IMPORTANT. Never mix terms silently on the same proposal)
field: Estimated Annual Premium (only show if 12-month)
field: Program

Section 2: Agent Information
field: Agent Name
field: Agent Address
field: Agent Phone
field: Agent Email

S3: Driver Info (Ability to add more)
field: Driver Name
field: Gender (Male/ Female choices only)
field: Marital Status
field: License State

s4: Vehicle Info (Ability to add more)
f: Year / Make / Model / Trim
f: VIN
f: Vehicle Use
f: Garaging ZIP / County
f: Lienholder / Loss Payee
f: Rated Driver Assigned to Vehicle

s5: Coverages
f: Bodily Injury (BI) Limit - (This should be a split limit type (per person / per occurrence, like " $100,000 / $300,000") bi-limit for backend mapping (just 1). Also remember its premium cost, per vehicle. YOU ONLY DISPLAY 1 FIELD CALLED Bodily Injury (BI) Limit. IF it's not mentioned, just put N/A in the field (done by another part of code, dw).)
f: Property Damage (PD) Limit - (pd-limit for backend mapping (just 1). Also remember its premium cost, per vehicle. YOU ONLY DISPLAY 1 FIELD CALLED Bodily Injury (BI) Limit. IF it's not mentioned, just put N/A in the field (done by another part of code, dw).)
f: Medical Payments (MedPay) Limit - (same thing)
f: Uninsured / Underinsured Motorist Bodily Injury (UM/UIM BI) Limit - (This should be a split limit type (per person / per occurrence, like " $100,000 / $300,000"), but same thing as before. When AI trying to find this, check both the Vehicle level OR policy level depending on carrier)
f: Uninsured Motorist Property Damage (UMPD) Limit - (umpd-limit for backend mapping (just 1). Also remember its premium cost, per vehicle)
f: UMPD Deductible - (umpd-deductible for backend mapping (just 1). no need to remember cost since already captured)
f: Comprehensive Deductible (comprehensive-deductible for backend mapping (just 1), Also remember its premium cost, per vehicle. May also be labeled "Other Than Collision" or "OTC")
f: Collision Deductible (collision-deductible for backend mapping, Also remember its premium cost, per vehicle. May also be labeled "Other Than Collision" or "OTC")
f: Rental / Transportation Expenses Limit - (rtml-limit for backend mapping (just 1). Also remember its premium cost, per vehicle. If no information can be found for this, say "N/A")
f: Towing & Labor / Roadside Assistance Limit - (tlra-limit for backend mapping (just 1). Also remember its premium cost, per vehicle. If no information can be found for this, say "N/A")

s6: Payment Options
subheader: Full Pay (pay-in-full amount with discount applied if available)
f: Required down payment
f: Number of remaining installments
f: Amount per installment
f: Whether installment fees apply (and how much)
f: Whether EFT/auto-pay reduces the installment fee
subheader: Semi-Annual (down payment + remaining installment amount, if offered)
f: Required down payment
f: Number of remaining installments
f: Amount per installment
f: Whether installment fees apply (and how much)
f: Whether EFT/auto-pay reduces the installment fee
subheader: Quarterly (down payment + installment amount, if offered)
f: Required down payment
f: Number of remaining installments
f: Amount per installment
f: Whether installment fees apply (and how much)
f: Whether EFT/auto-pay reduces the installment fee
subheader: Monthly (down payment + installment amount + number of payments)
f: Required down payment
f: Number of remaining installments
f: Amount per installment
f: Whether installment fees apply (and how much)
f: Whether EFT/auto-pay reduces the installment fee
subheader: PAID-IN-FULL DISCOUNT (Some carriers offer a discount for paying in full. Only show this subsection when present. Give option to add this section via button.)
f: Gross Premium (before discount)
f: Discount Amount (use - before teh number, like "-$100")
f: Net Pay-in-Full Total
subheader: Fee Schedule
f: New Business / Policy Fee
f: Installment Fee (standard)
f: Installment Fee (EFT / auto-pay)
f: Returned Payment Fee
f: Reinstatement Fee
f: Late Fee 
f: Phone Payment Fee 

s7: Premium Summary
f: Subtotal (per vehicle. In this section, you add all the premiums per vehicle mentioned in the coverages section, if not directly provided in the quote sheet)
f: Policy-level premium subtotal (UM/UIM if at policy level)
f: Term premium total (before fees)
f: Fees total
f: Total cost (including fees)
f: Paid-in-full discount (if applicable)
f: Total pay-in-full (after discount)










