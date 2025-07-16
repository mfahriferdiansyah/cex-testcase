/*
    SweepAndReplinish
    1. listen to deposit and transfer event
    2. check the total balance of the wallet
    3. handle sweep from deposit wallet to warm wallet
        if hot_wallet:insufficient or
        periodical sweep are met
        emit sweep:deposit_wallet on success
    4. handle replinish from warm wallet to hot wallet
        if hot_wallet:insufficient or
        periodical replinish are met
        emit replinish:hot_wallet event on success
    5. handle sweep from warm wallet to cold wallet
        if warm_wallet:sweepable or
        if periodical sweep are met
        emit sweep:warm_wallet on success
    6. handle replinish from cold wallet to warm wallet
        if warm_wallet:insufficient or
        periodical replinish are met
        emit replinish:warm_wallet event on success

    Event To Listen:
    hot_wallet:insufficient { wallet: id, amount: number }
    warm_wallet:sweepable { wallet: id, amount: number }
    warm_wallet:insufficient { wallet: id, amount: number }
    deposit_wallet:sweepable { wallet: id, amount: number }
    deposit_wallet:insufficient { wallet: id, amount: number }

    Event to emit:
    sweep:deposit_wallet { wallet: id, amount: number }
    sweep:warm_wallet { wallet: id, amount: number }
    replinish:hot_wallet { wallet: id, amount: number }
    replinish:warm_wallet { wallet: id, amount: number }
    gas:low { wallet: id, queue: id }

    ** periodical sweep are based on next predicted lowest gas occurance
    untuk serkarang ignore, dan dibuat cronjob
    replinish/batch are done batched
*/