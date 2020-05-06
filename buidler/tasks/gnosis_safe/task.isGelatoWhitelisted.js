import { task, types } from "@nomiclabs/buidler/config";

export default task(
  "is-gelato-whitelisted-module",
  "checks whether gelato core is a whitelisted module for a given gnosis safe"
)
  .addPositionalParam("safeaddress", "address of gnosis safe")
  .addFlag("log", "Logs return values to stdout")
  .setAction(async ({ safeaddress, log }) => {
    try {
      let gelatoIsWhitelisted = false;
      const user = config.networks.rinkeby.user();
      try {
        // check if Proxy is already deployed
        const gnosisSafe = await run("instantiateContract", {
          name: "IGnosisSafe",
          address: safeaddress,
          write: true,
          signer: user,
        });
        // Do a test call to see if contract exist
        await gnosisSafe.getOwners();
        if (log) console.log("User already has safe deployed");

        // Check if gelato is whitelisted module
        const whitelistedModules = await gnosisSafe.getModules();
        for (const module of whitelistedModules) {
          if (
            ethers.utils.getAddress(module) ===
            ethers.utils.getAddress(
              config.networks.rinkeby.addressBook.gelato.gelatoCore
            )
          ) {
            gelatoIsWhitelisted = true;
            break;
          }
        }
        if (log)
          console.log(`Is gelato an enabled module? ${gelatoIsWhitelisted}`);
        return gelatoIsWhitelisted;
      } catch (error) {
        if (log) console.log("safe not deployed, deploy safe and execute tx");
        return gelatoIsWhitelisted;
      }
    } catch (err) {
      console.error(err);
    }
  });
