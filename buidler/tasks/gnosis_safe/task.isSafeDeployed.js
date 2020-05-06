import { task, types } from "@nomiclabs/buidler/config";

export default task(
  "is-safe-deployed",
  "checks whether gelato core is a whitelisted module for a given gnosis safe"
)
  .addPositionalParam("safeaddress", "address of gnosis safe")
  .addFlag("log", "Logs return values to stdout")
  .setAction(async ({ safeaddress, log }) => {
    try {
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
        if (log) console.log("Safe already deployed");
        return true;
      } catch (error) {
        if (log) console.log("safe not deployed");
        return false;
      }
    } catch (err) {
      console.error(err);
    }
  });
