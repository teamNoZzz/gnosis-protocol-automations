import { task } from "@nomiclabs/buidler/config";

export default task("testy", "conducts a test").setAction(async (taskArgs) => {
  try {
    const userWallet = new ethers.Wallet(
      config.networks.rinkeby.accounts.user,
      ethers.provider
    );
    const userAddress = await userWallet.getAddress();
    console.log(userAddress);
    console.log(config.networks.rinkeby.addressBook.gelato.executor);
  } catch (err) {
    console.error(err);
  }
});
