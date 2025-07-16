/* 
    RequestWithdrawal
    1. get withdrawal amount & address, change status to processing
    2. check if the withdrawal amount is greater than the balance
    3. emit withdrawal:request event
    4. check if it's more than safe withdrawal treshold, minimal suspicious withdrawal
    5. check if hot wallet sufficient
    6. if not, emit withdrawal::hot_insufficient event
    7. check if the warm wallet sufficient
    8. if not, emit withdrawal::warm_insufficient event
    9. waiting for replinish:hot_wallet event
    10. insert withdrawal to queue

    QueueWithdrawalExecutor
    1. get batch of withdrawal from queue
    2. check if the withdrawal amount is greater than the balance
    3. if not, waiting for replinish:hot_wallet event
    3. execute withdrawal transaction
    4. change status to success or pending
    5. emit withdrawal:success or withdrawal:pending event
    6. remove withdrawal from queue
*/

