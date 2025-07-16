/*
    GasController
    1. listen to gas event
    2. check the gas price
    3. if the gas is below the buffer, refill the gas to reach the cap

    Event to listen:
    gas:low {
        wallet: id
    }

    Event to emit:
    gas:refill {
        wallet: id,
        amount: number
        hash: string
    }

    Buffer of gas tx based on wallet:
    1. hot_wallet: 100
    2. warm_wallet: 50
    3. cold_wallet: 0 (only request on withdrawal signal trigerred)
    4. deposit_wallet: 1
*/
