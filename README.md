# Gnosis Protocol | Gelato Automation features

This repository contains scripts that showcase how to automate various use cases such as placing orders on the gnosis protocol and scheduling an automated withdraw on behalf of users using gelato.

## Installation

```bash
git clone https://github.com/gelatodigital/gnosis-protocol-automations.git
cd gnosis-protocol-automations
npm install
```

## Usage (Rinkeby)

1. Create an .env file, store a private key in USER_PK and your infura id in INFURA_ID (make sure to put .env in .gitignore)
2. Make sure to have sufficient ETH in your user account and get some Rinkeby DAI from [Compund's Rinkeby UI](https://app.compound.finance/) (Supply DAI => Withdraw => Faucet)
3. To deploy a gnosis safe, place an order on gnosis protocol (DAI for WETH) and schedule an automated withdraw via gelato in one transaction, input the following command:

```bash
npx builder place-order-with-automated-withdraw  \
--selltoken 0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa  \
--buytoken 0xc778417e063141139fce010982780140aa0cd5ab  \
--sellamount 5000000000000000000 --buyamount 100000000000000 --seconds 600  \
--gelatoprovider 0x518eAa8f962246bCe2FA49329Fe998B66d67cbf8  --log
```
4. Check your account after 10 minutes and notice gelato automatically called the withdraw function on the gnosis protocol on your behalf

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests as appropriate.
