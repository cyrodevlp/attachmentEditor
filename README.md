# attachmentEditor
Edit image attachments before sending or after sending. Click the gear icon on an image to open the editor.

## First time setting up custom plugins?
Follow this [Guide](https://docs.vencord.dev/installing/custom-plugins/) to set-up custom plugins in your directory.

## How to install a plugin?
1. Direct your terminal to the `userplugins` folder, e.g. `cd Vencord/src/userplugins` or if you are already inside the `Vencord` folder, then do `cd src/userplugins`. 
2. Copy a GitHub repo link: 
```cmd
 https://github.com/cyrodevlp/attachmentEditor
```
3. Inside your terminal, run
```sh
git clone https://github.com/cyrodevlp/attachmentEditor
```

## How do I receive updates for this plugin?
You will have to make sure to keep up with the latest changes to fix issues and get new features.
The updates will be available to you through this Github page only.
You can update attachmentEditor by directing your terminal to its folder (`cd Vencord/src/userplugins/attachmentEditor` or `cd src/userplugins/attachmentEditor`) and by running this shell prompt:
```sh
git pull
```

### Image Processing & Privacy Notice

This plugin uses IOPaint for image processing. IOPaint runs locally on your machine, and image processing requests are sent to your local IOPaint instance rather than a third party image processing service or an individual with another server or computer.

Your images stays to your computer only
