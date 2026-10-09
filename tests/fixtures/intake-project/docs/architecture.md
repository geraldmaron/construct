# Architecture

Checkout creates a session for a cart and hands it to payments. Payments
authorizes and captures the charge with the card processor, then posts the
captured amount to the ledger. Refunds run the same path in reverse.

```
cart -> checkout session -> payments (authorize, capture) -> ledger (post)
                                   \-> processor API
```

The ledger is double-entry: every posting debits one account and credits
another for the same amount, in the same currency. Nothing writes to the
ledger except payments.

Services talk over HTTP today. Moving the payment-to-ledger hop onto an event
bus is under discussion.
